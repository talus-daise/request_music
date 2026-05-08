
import type { Env } from "./lib/types";
import { cspHeaders } from "./lib/utils";

// 拡張子ごとのContent-Typeマップ
const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json"
};

function getExt(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const response = await context.next();
  const headers = new Headers(response.headers);
  const security = cspHeaders();
  for (const [k, v] of Object.entries(security)) headers.set(k, v);

  // 静的ファイルの場合はContent-Typeを補完
  const url = new URL(context.request.url);
  const ext = getExt(url.pathname);
  if (!headers.has("content-type") && MIME_TYPES[ext]) {
    headers.set("content-type", MIME_TYPES[ext]);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
