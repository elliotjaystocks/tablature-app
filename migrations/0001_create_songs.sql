-- One row per song. The tab itself (string count, tuning, bars) is stored as JSON in `data`.
CREATE TABLE songs (
  id          TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Untitled song',
  song_date   TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL,
  has_image   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX songs_by_user ON songs (user_email, updated_at DESC);
