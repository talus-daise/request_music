import type { Env } from "../lib/types";
import { getPlaybackState, MAX_PLAY_SECONDS, serializePlaybackState } from "../lib/playback";
import { jsonResponse } from "../lib/utils";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json<Record<string, unknown>>().catch(() => ({}));
    const requestId = Number(body.request_id);
    const requestedDuration = Number(body.duration_sec);

    if (!Number.isInteger(requestId) || !Number.isFinite(requestedDuration)) {
      return jsonResponse({ error: "曲の長さが不正です。" }, 400);
    }

    const state = await getPlaybackState(env);
    if (state.status !== "playing" || state.request_id !== requestId) {
      return jsonResponse(serializePlaybackState(state));
    }

    const durationSec = Math.min(MAX_PLAY_SECONDS, Math.max(1, Math.floor(requestedDuration)));
    await env.DB.prepare(
      `UPDATE playback_state
       SET duration_sec = ?1,
           updated_at = datetime('now')
       WHERE id = 1
         AND status = 'playing'
         AND request_id = ?2`
    ).bind(durationSec, requestId).run();

    return jsonResponse(serializePlaybackState(await getPlaybackState(env)));
  } catch (error) {
    console.error("Failed to update playback duration", error);
    return jsonResponse({ error: "曲の長さの更新に失敗しました。" }, 500);
  }
};
