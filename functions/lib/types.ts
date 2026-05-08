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
