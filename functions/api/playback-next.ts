import type { Env } from "../lib/types";
import { getPlaybackState, MAX_PLAY_SECONDS, selectRandomSong, serializePlaybackState } from "../lib/playback";
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
  const state = await getPlaybackState(env);
  const body = await request.json<Record<string, unknown>>().catch(() => ({}));
  const currentRequestId = Number(body.current_request_id);

  if (
    Number.isInteger(currentRequestId) &&
    state.request_id !== null &&
    currentRequestId !== state.request_id
  ) {
    return jsonResponse(serializePlaybackState(state));
  }

  if (state.status === "playing" && state.request_id !== null) {
    const lockResult = await env.DB.prepare(
      `UPDATE playback_state
       SET status = 'stopped',
           updated_at = datetime('now')
       WHERE id = 1
         AND status = 'playing'
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
         updated_at = datetime('now')
     WHERE id = 1`
  ).bind(song.id, song.student_id, song.title, song.recommendation, song.youtube_id, MAX_PLAY_SECONDS).run();

  const nextState = await getPlaybackState(env);
  return jsonResponse(serializePlaybackState(nextState));
};
