import type { Env } from "../lib/types";
import { formatPlaybackTimestamp, getPlaybackState, MAX_PLAY_SECONDS, selectRandomSong, serializePlaybackState } from "../lib/playback";
import { jsonResponse } from "../lib/utils";

async function markPlayed(env: Env, requestId: number | null): Promise<void> {
  if (!requestId) return;

  const target = await env.DB.prepare(
    `SELECT id, student_id
     FROM requests
     WHERE id = ?1
     LIMIT 1`
  ).bind(requestId).first<{ id: number; student_id: string }>();

  if (!target) return;

  const alreadyPlayedToday = await env.DB.prepare(
    `SELECT 1
     FROM play_history ph
     JOIN requests r ON r.id = ph.request_id
     WHERE r.student_id = ?1
       AND r.id != ?2
       AND date(datetime(ph.played_at, '+9 hours')) = date(datetime('now', '+9 hours'))
     LIMIT 1`
  ).bind(target.student_id, requestId).first();

  if (alreadyPlayedToday) return;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE requests
       SET played = 1,
           played_today = 1,
           play_count = play_count + 1,
           last_played_at = datetime('now')
       WHERE id = ?1
         AND played = 0`
    ).bind(requestId),
    env.DB.prepare(
      `INSERT INTO play_history (request_id)
       SELECT ?1
       WHERE NOT EXISTS (
         SELECT 1 FROM play_history WHERE request_id = ?1
       )`
    ).bind(requestId)
  ]);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const state = await getPlaybackState(env);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const currentRequestId = Number(body.current_request_id);

    if (
      Number.isInteger(currentRequestId) &&
      state.request_id !== null &&
      currentRequestId !== state.request_id
    ) {
      return jsonResponse(serializePlaybackState(state));
    }

    if (state.status === "stopped" && state.request_id !== null) {
      // The previous session stopped with this track unfinished (every
      // device left, or nobody was actually playing). Resume the same
      // track from the position it stopped at. It must NOT be marked as
      // played: only a track that plays through to the end (or is
      // explicitly skipped while playing) counts as played.
      const positionSec = Math.min(
        Math.max(0, Number(state.paused_position_sec ?? 0) || 0),
        state.duration_sec
      );
      const startedAt = formatPlaybackTimestamp(Date.now() - positionSec * 1000);
      await env.DB.prepare(
        `UPDATE playback_state
         SET status = 'playing',
             started_at = ?1,
             paused_at = NULL,
             paused_position_sec = NULL,
             no_player_since = NULL,
             updated_at = datetime('now')
         WHERE id = 1
           AND status = 'stopped'
           AND request_id = ?2`
      ).bind(startedAt, state.request_id).run();

      return jsonResponse(serializePlaybackState(await getPlaybackState(env)));
    }

    if ((state.status === "playing" || state.status === "paused") && state.request_id !== null) {
      const lockResult = await env.DB.prepare(
        `UPDATE playback_state
         SET status = 'stopped',
             paused_at = NULL,
             paused_position_sec = NULL,
             no_player_since = NULL,
             updated_at = datetime('now')
         WHERE id = 1
           AND status IN ('playing', 'paused')
           AND request_id = ?1`
      ).bind(state.request_id).run();

      if ((lockResult.meta.changes ?? 0) === 0) {
        const latest = await getPlaybackState(env);
        return jsonResponse(serializePlaybackState(latest));
      }
    }

    await markPlayed(env, state.request_id);

    const { song, error } = await selectRandomSong(env);

    if (!song) {
      await env.DB.prepare(
        `UPDATE playback_state
         SET request_id = NULL,
             student_id = NULL,
             title = NULL,
             recommendation = NULL,
             youtube_id = NULL,
             started_at = NULL,
             duration_sec = ?1,
             status = 'stopped',
             paused_at = NULL,
             paused_position_sec = NULL,
             no_player_since = NULL,
             updated_at = datetime('now')
         WHERE id = 1`
      ).bind(MAX_PLAY_SECONDS).run();

      const stopped = await getPlaybackState(env);
      return jsonResponse({ ...serializePlaybackState(stopped), error }, 404);
    }

    await env.DB.prepare(
      `UPDATE playback_state
       SET request_id = ?1,
           student_id = ?2,
           title = ?3,
           recommendation = ?4,
           youtube_id = ?5,
           started_at = datetime('now'),
           duration_sec = ?6,
           status = 'playing',
           paused_at = NULL,
           paused_position_sec = NULL,
           no_player_since = NULL,
           updated_at = datetime('now')
       WHERE id = 1`
    ).bind(song.id, song.student_id, song.title, song.recommendation, song.youtube_id, MAX_PLAY_SECONDS).run();

    const nextState = await getPlaybackState(env);
    return jsonResponse(serializePlaybackState(nextState));
  } catch (error) {
    console.error("Failed to advance playback", error);
    return jsonResponse({ error: "再生状態の更新に失敗しました。" }, 500);
  }
};
