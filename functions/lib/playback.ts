import type { Env, PlaybackStateRecord, RequestRecord } from "./types";
import { weightedPick } from "./utils";

const MAX_PLAY_SECONDS = 300;

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

export async function selectRandomSong(env: Env): Promise<{ song: RequestRecord | null; error?: string }> {
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

  const candidates = candidatesResult.results ?? [];

  if (candidates.length === 0) {
    const message = alreadyPlayedToday.length > 0
      ? "本日まだ流れていない人の未再生曲がありません。同じ人の曲は1日1曲までです。"
      : "未再生の曲がありません。すべてのリクエストが消化されました。";
    return { song: null, error: message };
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
  if (!selected) return { song: null, error: "選曲に失敗しました。" };

  await env.DB.prepare(
    `UPDATE requests
     SET last_played_at = datetime('now')
     WHERE id = ?1`
  ).bind(selected.id).run();

  return { song: selected };
}

export async function ensurePlaybackState(env: Env): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO playback_state (id, status, duration_sec)
     VALUES (1, 'stopped', ?1)`
  ).bind(MAX_PLAY_SECONDS).run();
}

export async function getPlaybackState(env: Env): Promise<PlaybackStateRecord> {
  await ensurePlaybackState(env);
  const state = await env.DB.prepare(
    `SELECT id, request_id, student_id, title, recommendation, youtube_id, started_at, duration_sec, status, updated_at
     FROM playback_state
     WHERE id = 1`
  ).first<PlaybackStateRecord>();

  if (!state) {
    throw new Error("Playback state is not initialized");
  }

  return state;
}

export function serializePlaybackState(state: PlaybackStateRecord, serverNow = new Date()) {
  const startedAt = state.started_at ? new Date(`${state.started_at.replace(" ", "T")}Z`) : null;
  const elapsed = state.status === "playing" && startedAt
    ? Math.max(0, Math.floor((serverNow.getTime() - startedAt.getTime()) / 1000))
    : 0;
  const positionSec = Math.min(elapsed, state.duration_sec);
  const remainingSec = Math.max(0, state.duration_sec - positionSec);

  return {
    status: state.status,
    request_id: state.request_id,
    student_id: state.student_id,
    title: state.title,
    recommendation: state.recommendation,
    youtube_id: state.youtube_id,
    started_at: state.started_at,
    duration_sec: state.duration_sec,
    server_now: serverNow.toISOString(),
    position_sec: positionSec,
    remaining_sec: remainingSec,
    updated_at: state.updated_at
  };
}

export { MAX_PLAY_SECONDS };
