// GET  /api/songs  – list your songs (without their tab, to keep it light)
// POST /api/songs  – create a song

import { json, errorResponse, insertSong } from '../../../lib/song.js';

export async function onRequestGet({ env, data }) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, song_date, data, has_image, updated_at
     FROM songs WHERE user_email = ? ORDER BY updated_at DESC`
  )
    .bind(data.user)
    .all();

  const songs = results.map((row) => {
    const { strings, tuning } = JSON.parse(row.data);
    return {
      id: row.id,
      name: row.name,
      date: row.song_date,
      strings,
      tuning,
      hasImage: Boolean(row.has_image),
      updatedAt: row.updated_at
    };
  });

  return json({ songs });
}

export async function onRequestPost({ request, env, data }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Expected JSON.');
  }

  const song = await insertSong(env.DB, data.user, body);
  return json({ song }, 201);
}
