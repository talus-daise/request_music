export interface Env {
  DB: D1Database;
  ADMIN_KEY?: string;
}

export interface RequestRecord {
  id: number;
  student_id: string;
  title: string;
  recommendation: string | null;
  youtube_id: string;
  created_at: string;
  played: number;
  played_today: number;
  play_count: number;
  last_played_at: string | null;
}

export interface PlaybackStateRecord {
  id: number;
  request_id: number | null;
  student_id: string | null;
  title: string | null;
  recommendation: string | null;
  youtube_id: string | null;
  started_at: string | null;
  duration_sec: number;
  status: "stopped" | "playing" | "paused";
  paused_at: string | null;
  paused_position_sec: number | null;
  no_player_since: string | null;
  updated_at: string;
}
