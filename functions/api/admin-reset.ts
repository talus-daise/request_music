import type { Env } from "../lib/types";
import { jsonResponse } from "../lib/utils";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const key = request.headers.get("x-admin-key");
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return jsonResponse({ error: "forbidden" }, 403);

  await env.DB.batch([
    env.DB.prepare("UPDATE requests SET played = 0, played_today = 0").run(),
    env.DB.prepare("DELETE FROM play_history").run()
  ]);

  return jsonResponse({ ok: true, message: "リセット完了" });
};
