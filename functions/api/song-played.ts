import type { Env } from "../lib/types";
import { jsonResponse } from "../lib/utils";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<Record<string, unknown>>();
  const requestId = Number(body.request_id);
  if (!Number.isInteger(requestId) || requestId <= 0) return jsonResponse({ error: "request_id不正" }, 400);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE requests
       SET played = 1,
           played_today = 1,
           play_count = play_count + 1,
           last_played_at = datetime('now')
       WHERE id = ?1`
    ).bind(requestId),
    env.DB.prepare("INSERT INTO play_history (request_id) VALUES (?1)").bind(requestId)
  ]);

  return jsonResponse({ ok: true });
};
