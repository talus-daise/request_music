import type { Env } from "../../lib/types";
import { isValidStudentId } from "../../lib/student";
import { extractYoutubeId, jsonResponse, sanitizeText } from "../../lib/utils";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const requestId = Number(params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return jsonResponse({ error: "IDが不正です。" }, 400);
    }

    const body = await request.json<Record<string, unknown>>();
    const studentId = sanitizeText(body.student_id, 10);
    const title = sanitizeText(body.title, 120);
    const recommendation = sanitizeText(body.recommendation, 400);
    const youtubeUrl = sanitizeText(body.youtube_url, 500);

    if (!isValidStudentId(studentId)) {
      return jsonResponse({ error: "学籍番号が不正です。" }, 400);
    }
    if (!title) {
      return jsonResponse({ error: "曲タイトルは必須です。" }, 400);
    }

    const youtubeId = extractYoutubeId(youtubeUrl);
    if (!youtubeId) {
      return jsonResponse({ error: "YouTube URL形式が不正です。" }, 400);
    }

    const existing = await env.DB.prepare(
      `SELECT id FROM requests WHERE id = ?1 LIMIT 1`
    ).bind(requestId).first();

    if (!existing) {
      return jsonResponse({ error: "対象の曲が見つかりません。" }, 404);
    }

    const duplicate = await env.DB.prepare(
      `SELECT id
       FROM requests
       WHERE youtube_id = ?1
         AND id != ?2
       LIMIT 1`
    ).bind(youtubeId, requestId).first();

    if (duplicate) {
      return jsonResponse({ error: "同じ動画は既に投稿済みです。" }, 409);
    }

    await env.DB.prepare(
      `UPDATE requests
       SET student_id = ?1,
           title = ?2,
           recommendation = ?3,
           youtube_id = ?4
       WHERE id = ?5`
    ).bind(
      studentId,
      title,
      recommendation || null,
      youtubeId,
      requestId
    ).run();

    return jsonResponse({ ok: true, message: "更新しました。" });
  } catch {
    return jsonResponse({ error: "更新処理中にエラーが発生しました。" }, 500);
  }
};
