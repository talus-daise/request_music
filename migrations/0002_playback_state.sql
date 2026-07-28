CREATE TABLE IF NOT EXISTS playback_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  request_id INTEGER,
  student_id TEXT,
  title TEXT,
  recommendation TEXT,
  youtube_id TEXT,
  started_at TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 300,
  status TEXT NOT NULL DEFAULT 'stopped',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES requests(id)
);

INSERT OR IGNORE INTO playback_state (id, status, duration_sec)
VALUES (1, 'stopped', 300);

CREATE TABLE IF NOT EXISTS playback_clients (
  client_id TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
