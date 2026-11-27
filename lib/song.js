// Shared server-side helpers: validating song data and talking to D1.

const MAX_BARS = 1000;
const MAX_COLUMNS = 64;
const MAX_CELL = 16;
const MAX_NAME = 200;
const MAX_NOTES = 20000;

const DEFAULT_TUNINGS = {
  6: ['E', 'B', 'G', 'D', 'A', 'E'],
  7: ['E', 'B', 'G', 'D', 'A', 'E', 'B']
};

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export function errorResponse(message, status = 400) {
  return json({ error: message }, status);
}

function cleanString(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// Make sure the tab part of a song is well-formed, whatever the client (or the model) sent.
// Strings are stored highest-pitched first, which is how tab is read on the page.
export function sanitiseTab(input = {}) {
  const strings = Number(input.strings) === 7 ? 7 : 6;

  const tuning = Array.from({ length: strings }, (_, i) => {
    const note = Array.isArray(input.tuning) ? cleanString(input.tuning[i], 4).trim() : '';
    return note || DEFAULT_TUNINGS[strings][i];
  });

  const rawBars = Array.isArray(input.bars) ? input.bars.slice(0, MAX_BARS) : [];
  const bars = rawBars.map((bar) => {
    const rawColumns = Array.isArray(bar?.columns) ? bar.columns.slice(0, MAX_COLUMNS) : [];
    const columns = rawColumns.map((column) => ({
      above: cleanString(column?.above, MAX_CELL * 2),
      notes: Array.from({ length: strings }, (_, i) =>
        Array.isArray(column?.notes) ? cleanString(column.notes[i], MAX_CELL).replace(/\s+/g, '') : ''
      )
    }));
    if (!columns.length) columns.push({ above: '', notes: Array(strings).fill('') });
    return { columns };
  });

  if (!bars.length) {
    bars.push({ columns: Array.from({ length: 8 }, () => ({ above: '', notes: Array(strings).fill('') })) });
  }

  return { strings, tuning, bars };
}

export function sanitiseMeta(input = {}) {
  return {
    name: cleanString(input.name, MAX_NAME).trim() || 'Untitled song',
    date: isIsoDate(input.date) ? input.date : today(),
    notes: cleanString(input.notes, MAX_NOTES)
  };
}

export function rowToSong(row) {
  return {
    id: row.id,
    name: row.name,
    date: row.song_date,
    notes: row.notes,
    hasImage: Boolean(row.has_image),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...JSON.parse(row.data)
  };
}

export async function insertSong(db, user, song, { hasImage = false } = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const meta = sanitiseMeta(song);
  const tab = sanitiseTab(song);

  await db
    .prepare(
      `INSERT INTO songs (id, user_email, name, song_date, notes, data, has_image, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, user, meta.name, meta.date, meta.notes, JSON.stringify(tab), hasImage ? 1 : 0, now, now)
    .run();

  return { id, ...meta, ...tab, hasImage, createdAt: now, updatedAt: now };
}

export async function findSong(db, user, id) {
  return db.prepare('SELECT * FROM songs WHERE id = ? AND user_email = ?').bind(id, user).first();
}
