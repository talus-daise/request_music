import type { Env } from "../lib/types";
import { selectRandomSong, MAX_PLAY_SECONDS } from "../lib/playback";
import { jsonResponse } from "../lib/utils";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { song, error } = await selectRandomSong(env);

  if (!song) {
    return jsonResponse({ error }, error === "選曲に失敗しました。" ? 500 : 404);
  }

  return jsonResponse({
    id: song.id,
    student_id: song.student_id,
    title: song.title,
    recommendation: song.recommendation,
    youtube_id: song.youtube_id,
    max_duration_sec: MAX_PLAY_SECONDS
  });
};
