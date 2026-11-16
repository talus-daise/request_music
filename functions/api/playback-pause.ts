import type { Env } from "../lib/types";
import { pausePlayback, serializePlaybackState } from "../lib/playback";
import { jsonResponse } from "../lib/utils";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const requestId = Number(body.request_id);
    const positionSec = Number(body.position_sec);

    if (!Number.isInteger(requestId)) {
      return jsonResponse({ error: "request_idが不正です。" }, 400);
    }

    // Idempotent: pausing an already paused/stopped or different track just
    // returns the current shared state.
    const state = await pausePlayback(
      env,
      requestId,
      Number.isFinite(positionSec) ? positionSec : Number.NaN
    );
    return jsonResponse(serializePlaybackState(state));
  } catch (error) {
    console.error("Failed to pause playback", error);
    return jsonResponse({ error: "再生の一時停止に失敗しました。" }, 500);
  }
};
