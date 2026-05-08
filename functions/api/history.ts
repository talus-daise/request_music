import type { Env } from "../lib/types";
import { jsonResponse } from "../lib/utils";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const result = await env.DB.prepare(
    `SELECT ph.id, ph.played_at, r.title, r.student_id
     FROM play_history ph
     JOIN requests r ON r.id = ph.request_id
     ORDER BY ph.played_at DESC
     LIMIT 100`
  ).all();
  return jsonResponse({ history: result.results });
};
