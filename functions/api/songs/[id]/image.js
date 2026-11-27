// GET /api/songs/:id/image – the original photo a song was imported from

import { errorResponse, findSong } from '../../../../lib/song.js';

export async function onRequestGet({ env, data, params }) {
  const row = await findSong(env.DB, data.user, params.id);
  if (!row || !row.has_image) return errorResponse('No image for this song.', 404);

  const object = await env.IMAGES.get(`songs/${params.id}.jpg`);
  if (!object) return errorResponse('Image not found.', 404);

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || 'image/jpeg',
      'cache-control': 'private, max-age=3600'
    }
  });
}
