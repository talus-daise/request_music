import type { Env } from "../lib/types";
import { removePlaybackClient } from "../lib/playback";
import { jsonResponse, sanitizeText } from "../lib/utils";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const clientId = sanitizeText(body.client_id, 80);

    if (!clientId) {
      return jsonResponse({ error: "client_id不正" }, 400);
    }

    await removePlaybackClient(env, clientId);
    // No immediate stop here: if this was the last device actually
    // playing, the nobody-playing reset clears the track after its
    // grace period, which also covers a device that comes right back.
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Failed to remove playback client", error);
    return jsonResponse({ error: "再生デバイスの終了処理に失敗しました。" }, 500);
  }
};
