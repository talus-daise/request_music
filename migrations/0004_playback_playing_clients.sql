-- Track whether each connected device is actually playing the video, so the
-- server can stop the shared playback when no device is playing anymore
-- instead of letting the timer run a track nobody hears (and marking it as
-- played). no_player_since marks when the "nobody is playing" period began.
ALTER TABLE playback_clients ADD COLUMN is_playing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playback_state ADD COLUMN no_player_since TEXT;
