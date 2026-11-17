import type { Env, PlaybackStateRecord, RequestRecord } from "./types";
import { weightedPick } from "./utils";

const MAX_PLAY_SECONDS = 300;
const ACTIVE_CLIENT_TTL_SECONDS = 15;
// How long the shared state may have no device actually playing before the
// server freezes the track. Long enough to cover buffering and track
// changes, short enough that a track nobody hears does not run to the end
// (and get marked as played) on the timer alone.
const NO_PLAYING_GRACE_SECONDS = 10;
const ACTIVE_CLIENT_STALE_MODIFIER = `-${ACTIVE_CLIENT_TTL_SECONDS} seconds`;

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

export function parsePlaybackTimestamp(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(`${value.replace(" ", "T")}Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function formatPlaybackTimestamp(ms: number): string {
  // Store with millisecond precision ("YYYY-MM-DD HH:MM:SS.mmm", UTC) so a
  // pause/resume cycle does not lose up to a second every time it happens.
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

export async function ensurePlaybackState(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS playback_state (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       request_id INTEGER,
       student_id TEXT,
       title TEXT,
       recommendation TEXT,
       youtube_id TEXT,
       started_at TEXT,
       duration_sec INTEGER NOT NULL DEFAULT 300,
       status TEXT NOT NULL DEFAULT 'stopped',
       paused_at TEXT,
       paused_position_sec REAL,
       no_player_since TEXT,
       updated_at TEXT NOT NULL DEFAULT (datetime('now')),
       FOREIGN KEY (request_id) REFERENCES requests(id)
     )`
  ).run();

  // Tables created before pause support lack the newer columns. Adding them
  // here keeps existing databases working even before migrations 0003/0004
  // run.
  for (const column of ["paused_at TEXT", "paused_position_sec REAL", "no_player_since TEXT"]) {
    try {
      await env.DB.prepare(`ALTER TABLE playback_state ADD COLUMN ${column}`).run();
    } catch {
      // Column already exists.
    }
  }

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS playback_clients (
       client_id TEXT PRIMARY KEY,
       last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
       is_playing INTEGER NOT NULL DEFAULT 0
     )`
  ).run();

  try {
    await env.DB.prepare(`ALTER TABLE playback_clients ADD COLUMN is_playing INTEGER NOT NULL DEFAULT 0`).run();
  } catch {
    // Column already exists.
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO playback_state (id, status, duration_sec)
     VALUES (1, 'stopped', ?1)`
  ).bind(MAX_PLAY_SECONDS).run();
}

export async function pruneInactivePlaybackClients(env: Env): Promise<void> {
  await ensurePlaybackState(env);
  await env.DB.prepare(
    `DELETE FROM playback_clients
     WHERE datetime(last_seen_at) < datetime('now', ?1)`
  ).bind(ACTIVE_CLIENT_STALE_MODIFIER).run();
}

export async function recordPlaybackClientHeartbeat(env: Env, clientId: string, isPlaying = false): Promise<void> {
  await ensurePlaybackState(env);
  await env.DB.prepare(
    `INSERT INTO playback_clients (client_id, last_seen_at, is_playing)
     VALUES (?1, datetime('now'), ?2)
     ON CONFLICT(client_id) DO UPDATE SET last_seen_at = datetime('now'), is_playing = ?2`
  ).bind(clientId, isPlaying ? 1 : 0).run();
}

export async function removePlaybackClient(env: Env, clientId: string): Promise<void> {
  await ensurePlaybackState(env);
  await env.DB.prepare(
    `DELETE FROM playback_clients
     WHERE client_id = ?1`
  ).bind(clientId).run();
}

export async function getActivePlaybackClientCount(env: Env): Promise<number> {
  await pruneInactivePlaybackClients(env);
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM playback_clients`
  ).first<{ count: number }>();

  return Number(result?.count ?? 0);
}

export async function getPlayingPlaybackClientCount(env: Env): Promise<number> {
  await pruneInactivePlaybackClients(env);
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM playback_clients
     WHERE is_playing = 1`
  ).first<{ count: number }>();

  return Number(result?.count ?? 0);
}

export async function stopPlaybackIfNoActiveClients(env: Env): Promise<void> {
  const activeClientCount = await getActivePlaybackClientCount(env);
  if (activeClientCount > 0) return;

  const state = await getPlaybackState(env);
  if (state.status !== 'playing' && state.status !== 'paused') return;

  // Keep the track and the position it stopped at. When a device comes
  // back, playback-next resumes this track from that position instead of
  // consuming it as "played" even though nobody heard it to the end.
  const positionSec = getPlaybackPositionSec(state, new Date());
  await env.DB.prepare(
    `UPDATE playback_state
     SET status = 'stopped',
         paused_at = NULL,
         paused_position_sec = ?1,
         no_player_since = NULL,
         updated_at = datetime('now')
     WHERE id = 1
       AND status IN ('playing', 'paused')`
  ).bind(positionSec).run();
}

// Devices can be connected (heartbeating) while none of them is actually
// playing the video, e.g. autoplay never engaged on any of them. If that
// lasts beyond the grace period, freeze the shared state like a pause:
// the server-side timer stops, and the track is not marked as played,
// because nobody is hearing it.
export async function freezePlaybackIfNobodyPlaying(env: Env): Promise<void> {
  const state = await getPlaybackState(env);

  if (state.status !== 'playing') {
    if (state.no_player_since) {
      await env.DB.prepare(
        `UPDATE playback_state
         SET no_player_since = NULL
         WHERE id = 1
           AND no_player_since IS NOT NULL`
      ).run();
    }
    return;
  }

  const activeClientCount = await getActivePlaybackClientCount(env);
  if (activeClientCount === 0) return; // stopPlaybackIfNoActiveClients owns that case

  const playingClientCount = await getPlayingPlaybackClientCount(env);
  const now = new Date();

  if (playingClientCount > 0) {
    if (state.no_player_since) {
      await env.DB.prepare(
        `UPDATE playback_state
         SET no_player_since = NULL
         WHERE id = 1
           AND status = 'playing'
           AND no_player_since IS NOT NULL`
      ).run();
    }
    return;
  }

  const sinceMs = parsePlaybackTimestamp(state.no_player_since);
  if (sinceMs === null) {
    await env.DB.prepare(
      `UPDATE playback_state
       SET no_player_since = ?1
       WHERE id = 1
         AND status = 'playing'`
    ).bind(formatPlaybackTimestamp(now.getTime())).run();
    return;
  }

  if (now.getTime() - sinceMs < NO_PLAYING_GRACE_SECONDS * 1000) return;

  const positionSec = getPlaybackPositionSec(state, now);
  await env.DB.prepare(
    `UPDATE playback_state
     SET status = 'paused',
         paused_at = ?1,
         paused_position_sec = ?2,
         no_player_since = NULL,
         updated_at = datetime('now')
     WHERE id = 1
       AND status = 'playing'`
  ).bind(formatPlaybackTimestamp(now.getTime()), positionSec).run();
}

export async function getPlaybackState(env: Env): Promise<PlaybackStateRecord> {
  await ensurePlaybackState(env);
  const state = await env.DB.prepare(
    `SELECT id, request_id, student_id, title, recommendation, youtube_id, started_at, duration_sec, status, paused_at, paused_position_sec, no_player_since, updated_at
     FROM playback_state
     WHERE id = 1`
  ).first<PlaybackStateRecord>();

  if (!state) {
    throw new Error("Playback state is not initialized");
  }

  return state;
}

function clampPositionSec(positionSec: number, durationSec: number): number {
  if (!Number.isFinite(positionSec)) return 0;
  return Math.min(Math.max(0, positionSec), durationSec);
}

function roundSec(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function getPlaybackPositionSec(state: PlaybackStateRecord, serverNow = new Date()): number {
  const startedAtMs = parsePlaybackTimestamp(state.started_at);
  if (state.status === "paused") {
    if (state.paused_position_sec !== null && state.paused_position_sec !== undefined) {
      return clampPositionSec(Number(state.paused_position_sec), state.duration_sec);
    }
    const pausedAtMs = parsePlaybackTimestamp(state.paused_at);
    if (startedAtMs !== null && pausedAtMs !== null) {
      return clampPositionSec((pausedAtMs - startedAtMs) / 1000, state.duration_sec);
    }
    return 0;
  }
  if (state.status !== "playing" || startedAtMs === null) return 0;
  return clampPositionSec((serverNow.getTime() - startedAtMs) / 1000, state.duration_sec);
}

export function serializePlaybackState(state: PlaybackStateRecord, serverNow = new Date()) {
  const startedAtMs = parsePlaybackTimestamp(state.started_at);
  // Keep sub-second precision: flooring the elapsed time here used to hand
  // every client a remaining time that was up to a second stale, and the
  // clients re-anchored to it on every sync, so the error accumulated.
  const positionSec = getPlaybackPositionSec(state, serverNow);
  const remainingSec = Math.max(0, state.duration_sec - positionSec);
  // The single source of truth for the countdown is this absolute deadline.
  // Clients derive their local deadline from ends_at and server_now on every
  // sync instead of decrementing a local counter, so syncs cannot drift.
  const endsAt = state.status === "playing" && startedAtMs !== null
    ? new Date(startedAtMs + state.duration_sec * 1000).toISOString()
    : null;

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
    ends_at: endsAt,
    position_sec: roundSec(positionSec),
    remaining_sec: roundSec(remainingSec),
    paused_at: state.paused_at,
    updated_at: state.updated_at
  };
}

export async function pausePlayback(
  env: Env,
  requestId: number,
  reportedPositionSec: number
): Promise<PlaybackStateRecord> {
  const state = await getPlaybackState(env);
  if (state.status !== "playing" || state.request_id !== requestId) {
    return state;
  }

  const now = new Date();
  const positionSec = Number.isFinite(reportedPositionSec)
    ? clampPositionSec(reportedPositionSec, state.duration_sec)
    : getPlaybackPositionSec(state, now);

  await env.DB.prepare(
    `UPDATE playback_state
     SET status = 'paused',
         paused_at = ?1,
         paused_position_sec = ?2,
         updated_at = datetime('now')
     WHERE id = 1
       AND status = 'playing'
       AND request_id = ?3`
  ).bind(formatPlaybackTimestamp(now.getTime()), positionSec, requestId).run();

  return getPlaybackState(env);
}

export async function resumePlayback(
  env: Env,
  requestId: number,
  reportedPositionSec: number
): Promise<PlaybackStateRecord> {
  const state = await getPlaybackState(env);
  if (state.status !== "paused" || state.request_id !== requestId) {
    return state;
  }

  const now = new Date();
  const positionSec = Number.isFinite(reportedPositionSec)
    ? clampPositionSec(reportedPositionSec, state.duration_sec)
    : getPlaybackPositionSec(state, now);
  // Re-anchor started_at so that "now - started_at" equals the frozen
  // position. The wall-clock deadline then continues from exactly where the
  // pause froze it, on every device at once.
  const startedAt = formatPlaybackTimestamp(now.getTime() - positionSec * 1000);

  await env.DB.prepare(
    `UPDATE playback_state
     SET status = 'playing',
         started_at = ?1,
         paused_at = NULL,
         paused_position_sec = NULL,
         updated_at = datetime('now')
     WHERE id = 1
       AND status = 'paused'
       AND request_id = ?2`
  ).bind(startedAt, requestId).run();

  return getPlaybackState(env);
}

export { ACTIVE_CLIENT_TTL_SECONDS, MAX_PLAY_SECONDS, NO_PLAYING_GRACE_SECONDS };
