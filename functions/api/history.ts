import type { Env } from "../lib/types";
import { jsonResponse } from "../lib/utils";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const showAll = url.searchParams.get("all") === "1";
  const limitClause = showAll ? "" : "LIMIT 100";

  const result = await env.DB.prepare(
    `SELECT ph.id, ph.played_at, r.title, r.student_id
     FROM play_history ph
     JOIN requests r ON r.id = ph.request_id
     ORDER BY ph.played_at DESC
     ${limitClause}`
  ).all();
  return jsonResponse({ history: result.results });
};
