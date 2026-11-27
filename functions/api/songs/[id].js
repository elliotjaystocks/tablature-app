// GET    /api/songs/:id  – one song, including its tab
// PUT    /api/songs/:id  – save changes (the editor sends the whole song)
// DELETE /api/songs/:id  – delete a song and its source image

import { json, errorResponse, findSong, rowToSong, sanitiseMeta, sanitiseTab } from '../../../lib/song.js';

export async function onRequestGet({ env, data, params }) {
  const row = await findSong(env.DB, data.user, params.id);
  if (!row) return errorResponse('Song not found.', 404);
  return json({ song: rowToSong(row) });
}

export async function onRequestPut({ request, env, data, params }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Expected JSON.');
  }

  const meta = sanitiseMeta(body);
  const tab = sanitiseTab(body);
  const now = new Date().toISOString();

  const result = await env.DB.prepare(
    `UPDATE songs SET name = ?, song_date = ?, notes = ?, data = ?, updated_at = ?
     WHERE id = ? AND user_email = ?`
  )
    .bind(meta.name, meta.date, meta.notes, JSON.stringify(tab), now, params.id, data.user)
    .run();

  if (!result.meta.changes) return errorResponse('Song not found.', 404);
  return json({ updatedAt: now });
}

export async function onRequestDelete({ env, data, params }) {
  const row = await findSong(env.DB, data.user, params.id);
  if (!row) return errorResponse('Song not found.', 404);

  await env.DB.prepare('DELETE FROM songs WHERE id = ? AND user_email = ?').bind(params.id, data.user).run();
  if (row.has_image && env.IMAGES) await env.IMAGES.delete(`songs/${params.id}.jpg`);

  return json({ deleted: true });
}
