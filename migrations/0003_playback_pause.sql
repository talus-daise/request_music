-- Pause support for the shared playback state: when a track is paused on any
-- device, paused_at / paused_position_sec freeze the shared position so the
-- countdown stops on every device, and resume re-anchors started_at.
ALTER TABLE playback_state ADD COLUMN paused_at TEXT;
ALTER TABLE playback_state ADD COLUMN paused_position_sec REAL;
