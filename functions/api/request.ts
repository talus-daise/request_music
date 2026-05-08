import type { Env } from "../lib/types";
import { isValidStudentId } from "../lib/student";
import { extractYoutubeId, jsonResponse, sanitizeText } from "../lib/utils";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json<Record<string, unknown>>();
    const studentId = sanitizeText(body.student_id, 10);
    const title = sanitizeText(body.title, 120);
    const recommendation = sanitizeText(body.recommendation, 400);
    const youtubeUrl = sanitizeText(body.youtube_url, 500);

    if (!isValidStudentId(studentId)) return jsonResponse({ error: "学籍番号が不正です。" }, 400);
    if (!title) return jsonResponse({ error: "曲タイトルは必須です。" }, 400);

    const youtubeId = extractYoutubeId(youtubeUrl);
    if (!youtubeId) return jsonResponse({ error: "YouTube URL形式が不正です。" }, 400);

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const ua = sanitizeText(request.headers.get("user-agent") ?? "", 200);

    const rateHit = await env.DB.prepare(
      `SELECT 1 FROM request_rate_limit
       WHERE (student_id = ?1 OR ip_hash = ?2)
         AND created_at > datetime('now', '-30 seconds')
       LIMIT 1`
    ).bind(studentId, ip).first();

    if (rateHit) return jsonResponse({ error: "短時間での連続投稿はできません。30秒待ってください。" }, 429);

    const dup = await env.DB.prepare("SELECT id FROM requests WHERE youtube_id = ?1 LIMIT 1").bind(youtubeId).first();
    if (dup) return jsonResponse({ error: "同じ動画は既に投稿済みです。" }, 409);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO requests (student_id, title, recommendation, youtube_id)
         VALUES (?1, ?2, ?3, ?4)`
      ).bind(studentId, title, recommendation || null, youtubeId),
      env.DB.prepare(
        `INSERT INTO request_rate_limit (student_id, ip_hash, user_agent)
         VALUES (?1, ?2, ?3)`
      ).bind(studentId, ip, ua)
    ]);

    return jsonResponse({ ok: true, message: "投稿完了" }, 201);
  } catch {
    return jsonResponse({ error: "投稿処理中にエラーが発生しました。" }, 500);
  }
};
