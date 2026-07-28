import type { Env } from "../lib/types";
import { getPlaybackState, serializePlaybackState } from "../lib/playback";
import { jsonResponse } from "../lib/utils";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const state = await getPlaybackState(env);
  return jsonResponse(serializePlaybackState(state));
};
