// Where songs live: as files in this site's own GitHub repository.
//
//   songs/index.json        – the song list (name, date, strings, tuning)
//   songs/<id>.json         – one file per song, including its tab
//   songs/images/<id>.jpg   – the photo a song was imported from, if any
//
// With a GitHub token connected (in Settings), reads and writes go through the GitHub API,
// and every save is a commit. Without one, the app reads the copies GitHub Pages serves
// alongside the site, so anyone can view your songs but only you can edit them.

import { sanitiseTab, today } from './tab.js';
import { transcribeImage } from './claude.js';

const CONFIG_KEY = 'tablature-config';
const RECENT_KEY = 'tablature-recent-writes';
const INDEX_PATH = 'songs/index.json';

// Right after a save, GitHub can briefly serve the previous version of a file,
// so a copy we've just written is trusted for this long without asking.
const JUST_SAVED_MS = 60 * 1000;

// ——— Settings ————————————————————————————————————————————————————

export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function isOwner() {
  const { username, repo, token } = getConfig();
  return Boolean(username && repo && token);
}

// Checks the repository exists and the token is allowed to write to it.
export async function validateGitHub(username, repo, token) {
  const response = await fetch(`https://api.github.com/repos/${username}/${repo}`, {
    headers: githubHeaders(token),
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Couldn’t reach that repository (${response.status}).`);
  if (data.permissions && !data.permissions.push) {
    throw new Error('That token can read the repository but not write to it. Give it “Contents: Read and write”.');
  }
}

// ——— GitHub API ——————————————————————————————————————————————————

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function github(path, { method = 'GET', body, accept } = {}) {
  const { username, repo, token } = getConfig();
  const headers = githubHeaders(token);
  if (accept) headers.Accept = accept;
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
    method,
    headers,
    // The browser would otherwise cache GitHub's responses for up to a minute.
    cache: 'no-store',
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(
      response.status === 401
        ? 'GitHub didn’t accept your token. It may have expired: update it in Settings.'
        : data.message || `GitHub error ${response.status}`
    );
    error.status = response.status;
    throw error;
  }
  return response;
}

function encodeText(text) {
  const bytes = new TextEncoder().encode(text);
  return btoa(Array.from(bytes, (b) => String.fromCodePoint(b)).join(''));
}

function decodeText(base64) {
  const binary = atob(base64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.codePointAt(0)));
}

// A record of files we've just written: { path: { json, sha, savedAt } }.
function recentWrites() {
  try {
    return JSON.parse(sessionStorage.getItem(RECENT_KEY)) || {};
  } catch {
    return {};
  }
}

function rememberWrite(path, json, sha) {
  try {
    const recent = recentWrites();
    if (json === null) delete recent[path];
    else recent[path] = { json, sha, savedAt: Date.now() };
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // sessionStorage unavailable: we'll just ask GitHub every time
  }
}

// Resolves to { json, sha }, or { json: null, sha: null } if the file doesn't exist.
async function readJson(path) {
  if (!isOwner()) {
    const response = await fetch(path, { cache: 'no-cache' });
    if (response.status === 404) return { json: null, sha: null };
    if (!response.ok) throw new Error(`Couldn’t load ${path} (${response.status}).`);
    return { json: await response.json(), sha: null };
  }

  const recent = recentWrites()[path];
  if (recent && Date.now() - recent.savedAt < JUST_SAVED_MS) return recent;

  try {
    const data = await (await github(path)).json();
    return { json: JSON.parse(decodeText(data.content)), sha: data.sha };
  } catch (error) {
    if (error.status === 404) return { json: null, sha: null };
    throw error;
  }
}

async function currentSha(path) {
  try {
    return (await (await github(path)).json()).sha;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

// Writes a file. If it changed elsewhere since we read it (say, on another device),
// GitHub rejects our stale sha; we then fetch the latest sha and write again, so the
// most recent save wins.
async function writeFile(path, base64, sha, message, retried = false) {
  const body = { message, content: base64 };
  if (sha) body.sha = sha;
  try {
    const data = await (await github(path, { method: 'PUT', body })).json();
    return data.content.sha;
  } catch (error) {
    if (!retried && (error.status === 409 || error.status === 422)) {
      return writeFile(path, base64, await currentSha(path), message, true);
    }
    throw error;
  }
}

async function writeJson(path, json, sha, message) {
  const newSha = await writeFile(path, encodeText(JSON.stringify(json, null, 2) + '\n'), sha, message);
  rememberWrite(path, json, newSha);
  return newSha;
}

async function deleteFile(path, message) {
  const sha = await currentSha(path);
  if (!sha) return;
  await github(path, { method: 'DELETE', body: { message, sha } });
  rememberWrite(path, null);
}

// One write at a time, so the song list never gets two conflicting updates.
let queue = Promise.resolve();
function queued(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

// ——— Songs ————————————————————————————————————————————————————————

const songShas = new Map();

function summary(song) {
  return {
    id: song.id,
    name: song.name,
    date: song.date,
    strings: song.strings,
    tuning: song.tuning,
    hasImage: Boolean(song.hasImage)
  };
}

function sortSongs(songs) {
  return songs.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function prepare(song) {
  return {
    id: song.id,
    name: (song.name || '').trim() || 'Untitled song',
    date: /^\d{4}-\d{2}-\d{2}$/.test(song.date) ? song.date : today(),
    notes: song.notes || '',
    hasImage: Boolean(song.hasImage),
    ...sanitiseTab(song)
  };
}

async function updateIndex(change, message) {
  const { json, sha } = await readJson(INDEX_PATH);
  const songs = change(Array.isArray(json?.songs) ? json.songs : []);
  await writeJson(INDEX_PATH, { songs: sortSongs(songs) }, sha, message);
}

function requireOwner() {
  if (!isOwner()) throw new Error('Connect your GitHub repository in Settings to make changes.');
}

function requireSafeId(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error('That song link isn’t valid.');
}

export const api = {
  async listSongs() {
    const { json } = await readJson(INDEX_PATH);
    return sortSongs(Array.isArray(json?.songs) ? json.songs : []);
  },

  async getSong(id) {
    requireSafeId(id);
    const { json, sha } = await readJson(`songs/${id}.json`);
    if (!json) throw new Error('Song not found.');
    songShas.set(id, sha);
    return prepare({ ...json, id });
  },

  createSong(input, { image } = {}) {
    requireOwner();
    return queued(async () => {
      const song = prepare({ ...input, id: crypto.randomUUID(), hasImage: Boolean(image) });

      if (image) {
        await writeFile(`songs/images/${song.id}.jpg`, image, null, `Add photo for “${song.name}”`);
      }
      songShas.set(song.id, await writeJson(`songs/${song.id}.json`, song, null, `Add “${song.name}”`));
      await updateIndex((songs) => [...songs, summary(song)], `List “${song.name}”`);
      return song;
    });
  },

  saveSong(input) {
    requireOwner();
    return queued(async () => {
      const song = prepare(input);
      const path = `songs/${song.id}.json`;
      songShas.set(song.id, await writeJson(path, song, songShas.get(song.id), `Update “${song.name}”`));

      // Only touch the song list when something it shows has changed.
      const { json } = await readJson(INDEX_PATH);
      const listed = json?.songs?.find((s) => s.id === song.id);
      if (!listed || JSON.stringify(listed) !== JSON.stringify(summary(song))) {
        await updateIndex(
          (songs) => [...songs.filter((s) => s.id !== song.id), summary(song)],
          `Update song list for “${song.name}”`
        );
      }
    });
  },

  deleteSong(song) {
    requireOwner();
    return queued(async () => {
      await updateIndex((songs) => songs.filter((s) => s.id !== song.id), `Remove “${song.name}” from song list`);
      await deleteFile(`songs/${song.id}.json`, `Delete “${song.name}”`);
      if (song.hasImage) await deleteFile(`songs/images/${song.id}.jpg`, `Delete photo for “${song.name}”`);
      songShas.delete(song.id);
    });
  },

  async importImage(base64) {
    requireOwner();
    const { anthropicKey } = getConfig();
    if (!anthropicKey) throw new Error('Add your Anthropic API key in Settings to import photos.');

    const result = await transcribeImage(anthropicKey, base64, 'image/jpeg');
    return this.createSong(
      {
        name: result.title || 'Imported song',
        date: today(),
        notes: result.uncertainties ? `From the import: ${result.uncertainties}` : '',
        strings: result.stringCount,
        tuning: result.tuning,
        bars: result.bars
      },
      { image: base64 }
    );
  },

  // Resolves to a URL for the song's original photo.
  async imageUrl(id) {
    const path = `songs/images/${id}.jpg`;
    // Pages takes a minute or so to publish new files, so the owner fetches the photo from the API.
    if (!isOwner()) return path;
    const response = await github(path, { accept: 'application/vnd.github.raw+json' });
    return URL.createObjectURL(await response.blob());
  }
};
