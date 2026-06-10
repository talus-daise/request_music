import type { Env } from "../lib/types";
import { jsonResponse } from "../lib/utils";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<Record<string, unknown>>();
  const requestId = Number(body.request_id);
  if (!Number.isInteger(requestId) || requestId <= 0) return jsonResponse({ error: "request_id不正" }, 400);

  const target = await env.DB.prepare(
    `SELECT id, student_id
     FROM requests
     WHERE id = ?1
     LIMIT 1`
  ).bind(requestId).first<{ id: number; student_id: string }>();

  if (!target) {
    return jsonResponse({ error: "対象の曲が見つかりません。" }, 404);
  }

  const alreadyPlayedToday = await env.DB.prepare(
    `SELECT 1
     FROM play_history ph
     JOIN requests r ON r.id = ph.request_id
     WHERE r.student_id = ?1
       AND r.id != ?2
       AND date(datetime(ph.played_at, '+9 hours')) = date(datetime('now', '+9 hours'))
     LIMIT 1`
  ).bind(target.student_id, requestId).first();

  if (alreadyPlayedToday) {
    return jsonResponse({ error: "同じ人の曲は1日1曲までです。" }, 409);
  }

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
