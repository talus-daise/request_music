import type { Env } from "../../lib/types";
import { isValidStudentId } from "../../lib/student";
import { jsonResponse } from "../../lib/utils";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const studentId = params.id;
    if (!studentId || !isValidStudentId(studentId)) {
      return jsonResponse({ error: "学籍番号が不正です。" }, 400);
    }

    const body = await request.json<Record<string, unknown>>();
    if (typeof body.excluded_from_playback !== "boolean") {
      return jsonResponse({ error: "再生対象外の設定が不正です。" }, 400);
    }

    const excludedFromPlayback = body.excluded_from_playback ? 1 : 0;
    await env.DB.prepare(
      `INSERT INTO student_settings (student_id, excluded_from_playback, updated_at)
       VALUES (?1, ?2, datetime('now'))
       ON CONFLICT(student_id) DO UPDATE SET
         excluded_from_playback = excluded.excluded_from_playback,
         updated_at = datetime('now')`
    ).bind(studentId, excludedFromPlayback).run();

    return jsonResponse({
      ok: true,
      student_id: studentId,
      excluded_from_playback: Boolean(excludedFromPlayback),
      message: excludedFromPlayback ? "この人の曲を再生対象外にしました。" : "この人の曲を再生対象に戻しました。"
    });
  } catch {
    return jsonResponse({ error: "設定の更新中にエラーが発生しました。" }, 500);
  }
};
