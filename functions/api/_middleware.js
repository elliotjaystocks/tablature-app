// Every /api request must come from a signed-in user.
//
// Sign-in is handled by Cloudflare Access, which sits in front of the whole site and
// emails you a one-time code. Access adds a signed JWT to each request; we verify that
// signature here rather than trusting a plain header, so the API stays locked even if
// someone reaches the app by another URL.

import { errorResponse } from '../../lib/song.js';

let cachedKeys = null;
let cachedAt = 0;
const KEY_CACHE_MS = 60 * 60 * 1000;

function base64UrlToBytes(input) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function decodeJsonPart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

async function getSigningKeys(teamDomain, forceRefresh = false) {
  if (!forceRefresh && cachedKeys && Date.now() - cachedAt < KEY_CACHE_MS) return cachedKeys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('Could not fetch Cloudflare Access signing keys');
  cachedKeys = (await response.json()).keys || [];
  cachedAt = Date.now();
  return cachedKeys;
}

async function verifyAccessToken(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJsonPart(headerPart);
  const payload = decodeJsonPart(payloadPart);

  let keys = await getSigningKeys(env.ACCESS_TEAM_DOMAIN);
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    // Access rotates its keys; refresh once before giving up.
    keys = await getSigningKeys(env.ACCESS_TEAM_DOMAIN, true);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  );
  if (!valid) return null;

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const now = Math.floor(Date.now() / 1000);
  if (!audiences.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.email !== 'string' || !payload.email) return null;

  return payload.email.toLowerCase();
}

function readCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const { hostname } = new URL(request.url);
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

  let user = null;

  if (isLocal && env.DEV_USER_EMAIL) {
    user = env.DEV_USER_EMAIL.toLowerCase();
  } else if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = request.headers.get('cf-access-jwt-assertion') || readCookie(request, 'CF_Authorization');
    if (token) {
      try {
        user = await verifyAccessToken(token, env);
      } catch (error) {
        console.error('Access token check failed', error);
      }
    }
  }

  if (!user) return errorResponse('Please sign in.', 401);

  context.data.user = user;

  try {
    return await context.next();
  } catch (error) {
    console.error(error);
    return errorResponse('Something went wrong on the server.', 500);
  }
}
