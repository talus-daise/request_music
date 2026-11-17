import type { Env } from "../lib/types";
import { recordPlaybackClientHeartbeat } from "../lib/playback";
import { jsonResponse, sanitizeText } from "../lib/utils";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const clientId = sanitizeText(body.client_id, 80);

    if (!clientId) {
      return jsonResponse({ error: "client_id不正" }, 400);
    }

    // Clients report whether their video is actually playing (or trying to
    // play), so the server can stop the shared playback when no device is
    // playing anymore instead of letting the timer consume the track.
    await recordPlaybackClientHeartbeat(env, clientId, body.playing === true);
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Failed to record playback heartbeat", error);
    return jsonResponse({ error: "再生デバイスの状態更新に失敗しました。" }, 500);
  }
};
