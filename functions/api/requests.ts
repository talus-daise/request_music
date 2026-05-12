import type { Env } from "../lib/types";
import { jsonResponse } from "../lib/utils";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const unplayedOnly = url.searchParams.get("unplayedOnly") === "1";
  const where = unplayedOnly ? "WHERE played = 0" : "";

  const [listResult, statsResult, studentStats] = await Promise.all([
    env.DB.prepare(
      `SELECT id, student_id, title, recommendation, youtube_id, created_at, played, played_today, play_count, last_played_at
       FROM requests ${where}
       ORDER BY datetime(created_at) DESC
       LIMIT 200`
    ).all(),
    env.DB.prepare(
      `SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN played_today = 1 THEN 1 ELSE 0 END) AS today_played,
        SUM(CASE WHEN played = 0 THEN 1 ELSE 0 END) AS unplayed_count
       FROM requests`
    ).first(),
    env.DB.prepare(
      `SELECT student_id, COUNT(*) AS posted_count,
              SUM(CASE WHEN played = 1 THEN 1 ELSE 0 END) AS played_count
       FROM requests
       GROUP BY student_id
       ORDER BY posted_count DESC, student_id ASC`
    ).all()
  ]);

  return jsonResponse({
    requests: listResult.results,
    stats: statsResult,
    studentStats: studentStats.results
  });
};
