CREATE TABLE IF NOT EXISTS student_settings (
  student_id TEXT PRIMARY KEY,
  excluded_from_playback INTEGER NOT NULL DEFAULT 0
    CHECK (excluded_from_playback IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_settings_excluded
  ON student_settings(excluded_from_playback);
