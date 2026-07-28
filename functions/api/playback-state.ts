import type { Env } from "../lib/types";
import { getPlaybackState, serializePlaybackState, stopPlaybackIfNoActiveClients } from "../lib/playback";
import { jsonResponse } from "../lib/utils";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    await stopPlaybackIfNoActiveClients(env);
    const state = await getPlaybackState(env);
    return jsonResponse(serializePlaybackState(state));
  } catch (error) {
    console.error("Failed to get playback state", error);
    return jsonResponse({ error: "再生状態の取得に失敗しました。" }, 500);
  }
};
