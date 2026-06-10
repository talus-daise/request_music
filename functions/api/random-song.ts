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
  const alreadyPlayedTodayResult = await env.DB.prepare(
    `SELECT DISTINCT student_id
     FROM requests
     WHERE last_played_at IS NOT NULL
       AND date(datetime(last_played_at, '+9 hours')) = date(datetime('now', '+9 hours'))

     UNION

     SELECT DISTINCT r.student_id
     FROM play_history ph
     JOIN requests r ON r.id = ph.request_id
     WHERE date(datetime(ph.played_at, '+9 hours')) = date(datetime('now', '+9 hours'))`
  ).all<{ student_id: string }>();
  const alreadyPlayedToday = alreadyPlayedTodayResult.results.map((row) => row.student_id);
  const studentExclusionPlaceholders = alreadyPlayedToday.map((_, index) => `?${index + 1}`).join(", ");
  const studentExclusionClause = studentExclusionPlaceholders
    ? `AND student_id NOT IN (${studentExclusionPlaceholders})`
    : "";

  const candidatesStatement = env.DB.prepare(
    `SELECT *
     FROM requests
     WHERE played = 0
       ${studentExclusionClause}
       AND (
         last_played_at IS NULL OR
         datetime(last_played_at) < datetime('now', '-10 minutes')
       )
     ORDER BY created_at ASC`
  );
  const candidatesResult = alreadyPlayedToday.length > 0
    ? await candidatesStatement.bind(...alreadyPlayedToday).all<RequestRecord>()
    : await candidatesStatement.all<RequestRecord>();

  let candidates = candidatesResult.results ?? [];

  if (candidates.length === 0) {
    const message = alreadyPlayedToday.length > 0
      ? "本日まだ流れていない人の未再生曲がありません。同じ人の曲は1日1曲までです。"
      : "未再生の曲がありません。すべてのリクエストが消化されました。";
    return jsonResponse({ error: message }, 404);
  }

  const [totalByStudentResult, todayByStudentResult, recentResult] = await Promise.all([
    env.DB.prepare("SELECT student_id, COUNT(*) AS c FROM requests GROUP BY student_id").all<{student_id: string;c:number}>(),
    env.DB.prepare(
      `SELECT r.student_id, COUNT(ph.id) AS c
       FROM play_history ph
       JOIN requests r ON r.id = ph.request_id
       WHERE date(datetime(ph.played_at, '+9 hours')) = date(datetime('now', '+9 hours'))
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

  // 再生開始時点では未再生のままにしつつ、同じ人の曲を本日（JST）は再抽選から外します。
  // 同一曲の二重取得も避けるため、直近10分はこの曲自体も再抽選対象外にします。
  await env.DB.prepare(
    `UPDATE requests
     SET last_played_at = datetime('now')
     WHERE id = ?1`
  ).bind(selected.id).run();

  return jsonResponse({
    id: selected.id,
    student_id: selected.student_id,
    title: selected.title,
    recommendation: selected.recommendation,
    youtube_id: selected.youtube_id,
    max_duration_sec: 300
  });
};
