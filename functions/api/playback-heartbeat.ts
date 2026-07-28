import type { Env } from "../lib/types";
import { recordPlaybackClientHeartbeat } from "../lib/playback";
import { jsonResponse, sanitizeText } from "../lib/utils";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json<Record<string, unknown>>().catch(() => ({}));
    const clientId = sanitizeText(body.client_id, 80);

    if (!clientId) {
      return jsonResponse({ error: "client_id不正" }, 400);
    }

    await recordPlaybackClientHeartbeat(env, clientId);
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Failed to record playback heartbeat", error);
    return jsonResponse({ error: "再生デバイスの状態更新に失敗しました。" }, 500);
  }
};
