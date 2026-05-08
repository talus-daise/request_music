import type { Env, RequestRecord } from "../lib/types";
import { jsonResponse, weightedPick } from "../lib/utils";

function calcWeight(song: RequestRecord, totals: Map<string, number>, todayMap: Map<string, number>, recentMap: Map<string, number>): number {
  const posted = totals.get(song.student_id) ?? 1;
  const todayPlayed = todayMap.get(song.student_id) ?? 0;
  const recentPenalty = recentMap.get(song.student_id) ?? 0;

  const base = 1 / posted;
  const todayFactor = 1 / (1 + todayPlayed * 1.2);
  const recentFactor = Math.max(0.15, 1 - recentPenalty * 0.35);
  const replayFactor = song.play_count > 0 ? 1 / (1 + song.play_count * 0.5) : 1;

  return Math.max(0.001, base * todayFactor * recentFactor * replayFactor);
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const candidatesResult = await env.DB.prepare(
    `SELECT * FROM requests WHERE played = 0 ORDER BY created_at ASC`
  ).all<RequestRecord>();

  let candidates = candidatesResult.results ?? [];

  if (candidates.length === 0) {
    await env.DB.prepare("UPDATE requests SET played = 0, played_today = 0").run();
    const resetResult = await env.DB.prepare("SELECT * FROM requests ORDER BY created_at ASC").all<RequestRecord>();
    candidates = resetResult.results ?? [];
    if (candidates.length === 0) return jsonResponse({ error: "再生可能な曲がありません。" }, 404);
  }

  const [totalByStudentResult, todayByStudentResult, recentResult] = await Promise.all([
    env.DB.prepare("SELECT student_id, COUNT(*) AS c FROM requests GROUP BY student_id").all<{student_id: string;c:number}>(),
    env.DB.prepare(
      `SELECT r.student_id, COUNT(ph.id) AS c
       FROM play_history ph
       JOIN requests r ON r.id = ph.request_id
       WHERE ph.played_at >= date('now')
       GROUP BY r.student_id`
    ).all<{student_id:string;c:number}>(),
    env.DB.prepare(
      `SELECT r.student_id, COUNT(*) AS c
       FROM play_history ph
       JOIN requests r ON r.id = ph.request_id
       ORDER BY ph.played_at DESC
       LIMIT 5`
    ).all<{student_id:string;c:number}>()
  ]);

  const totals = new Map(totalByStudentResult.results.map((x) => [x.student_id, Number(x.c)]));
  const todayMap = new Map(todayByStudentResult.results.map((x) => [x.student_id, Number(x.c)]));
  const recentMap = new Map<string, number>();
  for (const row of recentResult.results) {
    recentMap.set(row.student_id, (recentMap.get(row.student_id) ?? 0) + 1);
  }

  const selected = weightedPick(candidates, (song) => calcWeight(song, totals, todayMap, recentMap));
  if (!selected) return jsonResponse({ error: "選曲に失敗しました。" }, 500);

  return jsonResponse({
    id: selected.id,
    student_id: selected.student_id,
    title: selected.title,
    recommendation: selected.recommendation,
    youtube_id: selected.youtube_id,
    max_duration_sec: 300
  });
};
