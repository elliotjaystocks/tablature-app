// Small wrapper around the app's own /api endpoints.

async function request(path, { method = 'GET', body, keepalive = false } = {}) {
  const response = await fetch(path, {
    method,
    keepalive,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  if (response.status === 401) {
    // Cloudflare Access session has expired: reload so Access can sign you back in.
    window.location.reload();
    throw new Error('Signing you in again…');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export const api = {
  listSongs: () => request('/api/songs').then((data) => data.songs),
  getSong: (id) => request(`/api/songs/${id}`).then((data) => data.song),
  createSong: (song) => request('/api/songs', { method: 'POST', body: song }).then((data) => data.song),
  saveSong: (song, options = {}) => request(`/api/songs/${song.id}`, { method: 'PUT', body: song, ...options }),
  deleteSong: (id) => request(`/api/songs/${id}`, { method: 'DELETE' }),
  importImage: (image, mediaType) =>
    request('/api/songs/import', { method: 'POST', body: { image, mediaType } }).then((data) => data.song),
  imageUrl: (id) => `/api/songs/${id}/image`
};
