const YOUTUBE_PATTERNS = [
  /^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})(?:[&?].*)?$/,
  /^https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})(?:[?&].*)?$/,
  /^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?&].*)?$/
];

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store"
    }
  });
}

export function sanitizeText(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  const normalized = input.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return normalized.slice(0, maxLen);
}

export function extractYoutubeId(url: string): string | null {
  const trimmed = url.trim();
  for (const p of YOUTUBE_PATTERNS) {
    const m = trimmed.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function cspHeaders(): HeadersInit {
  return {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.youtube-nocookie.com https://s.ytimg.com; style-src 'self' 'unsafe-inline'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; img-src 'self' data: https://i.ytimg.com; connect-src 'self' https://www.youtube.com https://www.youtube-nocookie.com;",
    "referrer-policy": "same-origin",
    "x-frame-options": "SAMEORIGIN"
  };
}

export function weightedPick<T>(items: T[], weightFn: (item: T) => number): T | null {
  let total = 0;
  const weighted = items.map((item) => {
    const w = Math.max(0, weightFn(item));
    total += w;
    return { item, w };
  });
  if (total <= 0) return null;
  let rand = Math.random() * total;
  for (const entry of weighted) {
    rand -= entry.w;
    if (rand <= 0) return entry.item;
  }
  return weighted[weighted.length - 1]?.item ?? null;
}
