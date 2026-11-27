// POST /api/songs/import
// Body: { image: <base64 JPEG/PNG/WebP/GIF>, mediaType: "image/jpeg", name?: string }
//
// Sends a photo of handwritten tab to Claude, which reads it into the app's tab format.
// The new song is saved straight away (with the photo kept in R2) so you can correct it.

import Anthropic from '@anthropic-ai/sdk';
import { json, errorResponse, insertSong } from '../../../lib/song.js';

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SYSTEM_PROMPT = `You transcribe photos of handwritten guitar tablature into structured data.

How the data is laid out:
- A song is a list of bars (measures). Bar lines in the photo ("|") separate bars. If the writer used no bar lines, split the tab into bars where the phrasing or spacing suggests, roughly 4 to 16 columns each.
- Each bar is a list of columns, read left to right. A column is one moment in time: the notes struck together (a chord) share a column; notes played one after another get their own columns.
- Keep the horizontal spacing approximately as written: if there is a clear gap between notes, add an empty column so the rhythm feel is preserved.
- "notes" in each column has exactly one entry per string, ordered from the highest-pitched string (the top line of the tab) to the lowest. Use "" for a string that is not played in that column.
- "above" holds any text written above that column of the staff, such as "PM", "P.M.", "let ring" or a chord name. Use "" when there is none.
- If the photo has several lines (systems) of tab, read them top to bottom and append their bars in order.

How to write each note (one short token, no spaces):
- A fret number: "0", "3", "12".
- Techniques joined to the note they lead from, as in text tab: hammer-on "5h7", pull-off "7p5", slide up "5/7", slide down "7\\5", bend "7b9", bend and release "7b9r7", vibrato "7~", tapped "t12", muted or dead note "x", natural harmonic "<12>".
- When a technique joins two notes that the writer spaced apart, put the whole thing ("5h7") in the column of the first note and leave the second column empty for that string.

Tuning:
- "tuning" lists the open-string note names in the same order as the strings (highest first), e.g. standard 6-string is ["E","B","G","D","A","E"].
- Use the letters written at the start of the staff if present (treat a lowercase "e" as "E"). Otherwise assume standard tuning for the number of strings.
- "stringCount" is the number of lines in the staff: 6 or 7.

Also:
- "title" is the song name if one is written on the page, otherwise "".
- "uncertainties" is a short plain-English note of anything you could not read confidently (for example "Bar 5, B string: could be 8 or 9"), or "" if everything was clear.
Transcribe exactly what is written. Do not correct, simplify or embellish the music.`;

const TAB_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    stringCount: { type: 'integer', enum: [6, 7] },
    tuning: { type: 'array', items: { type: 'string' } },
    bars: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          columns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                above: { type: 'string' },
                notes: { type: 'array', items: { type: 'string' } }
              },
              required: ['above', 'notes'],
              additionalProperties: false
            }
          }
        },
        required: ['columns'],
        additionalProperties: false
      }
    },
    uncertainties: { type: 'string' }
  },
  required: ['title', 'stringCount', 'tuning', 'bars', 'uncertainties'],
  additionalProperties: false
};

function base64ToBytes(base64) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function transcribe(env, image, mediaType) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    // If Claude's safety classifiers ever decline a request, retry on Anthropic's recommended fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: TAB_SCHEMA }
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: 'Transcribe the guitar tab in this photo.' }
        ]
      }
    ]
  });

  if (response.stop_reason === 'refusal') {
    throw new UserFacingError('Claude declined to read this image. Try a different photo.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new UserFacingError('This tab is too long to read in one go. Try photographing it in smaller sections.');
  }

  const text = response.content.find((block) => block.type === 'text')?.text;
  if (!text) throw new UserFacingError('Claude did not return any tab for this image.');
  return JSON.parse(text);
}

class UserFacingError extends Error {}

export async function onRequestPost({ request, env, data }) {
  if (!env.ANTHROPIC_API_KEY) {
    return errorResponse('Image import is not set up yet: the ANTHROPIC_API_KEY secret is missing.', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Expected JSON.');
  }

  const { image, mediaType } = body;
  if (typeof image !== 'string' || !MEDIA_TYPES.includes(mediaType)) {
    return errorResponse('Please upload a JPEG, PNG, WebP or GIF image.');
  }

  const bytes = base64ToBytes(image);
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return errorResponse('That image is too large. Please use one under 5 MB.');
  }

  let result;
  try {
    result = await transcribe(env, image, mediaType);
  } catch (error) {
    if (error instanceof UserFacingError) return errorResponse(error.message, 422);
    if (error instanceof Anthropic.RateLimitError) {
      return errorResponse('The image service is busy right now. Please try again in a minute.', 503);
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return errorResponse('The Anthropic API key is not valid. Check the ANTHROPIC_API_KEY secret.', 500);
    }
    if (error instanceof Anthropic.APIError) {
      console.error('Anthropic API error', error.status, error.message);
      return errorResponse('Claude could not read this image. Please try again.', 502);
    }
    throw error;
  }

  const notes = result.uncertainties ? `From the import: ${result.uncertainties}` : '';

  const song = await insertSong(
    env.DB,
    data.user,
    {
      name: body.name || result.title || 'Imported song',
      notes,
      strings: result.stringCount,
      tuning: result.tuning,
      bars: result.bars
    },
    { hasImage: Boolean(env.IMAGES) }
  );

  if (env.IMAGES) {
    await env.IMAGES.put(`songs/${song.id}.jpg`, bytes, { httpMetadata: { contentType: mediaType } });
  }

  return json({ song }, 201);
}
