var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// lib/utils.ts
var YOUTUBE_PATTERNS = [
  /^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})(?:[&?].*)?$/,
  /^https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})(?:[?&].*)?$/,
  /^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?&].*)?$/
];
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store"
    }
  });
}
__name(jsonResponse, "jsonResponse");
function sanitizeText(input, maxLen) {
  if (typeof input !== "string") return "";
  const normalized = input.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return normalized.slice(0, maxLen);
}
__name(sanitizeText, "sanitizeText");
function extractYoutubeId(url) {
  const trimmed = url.trim();
  for (const p of YOUTUBE_PATTERNS) {
    const m = trimmed.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}
__name(extractYoutubeId, "extractYoutubeId");
function cspHeaders() {
  return {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.youtube-nocookie.com https://s.ytimg.com; style-src 'self' 'unsafe-inline'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; img-src 'self' data: https://i.ytimg.com; connect-src 'self' https://www.youtube.com https://www.youtube-nocookie.com;",
    "referrer-policy": "same-origin",
    "x-frame-options": "SAMEORIGIN"
  };
}
__name(cspHeaders, "cspHeaders");
function weightedPick(items, weightFn) {
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
__name(weightedPick, "weightedPick");

// api/admin-reset.ts
var onRequestPost = /* @__PURE__ */ __name(async ({ request, env }) => {
  const key = request.headers.get("x-admin-key");
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return jsonResponse({ error: "forbidden" }, 403);
  await env.DB.batch([
    env.DB.prepare("UPDATE requests SET played = 0, played_today = 0").run(),
    env.DB.prepare("DELETE FROM play_history").run()
  ]);
  return jsonResponse({ ok: true, message: "\u30EA\u30BB\u30C3\u30C8\u5B8C\u4E86" });
}, "onRequestPost");

// api/history.ts
var onRequestGet = /* @__PURE__ */ __name(async ({ env }) => {
  const result = await env.DB.prepare(
    `SELECT ph.id, ph.played_at, r.title, r.student_id
     FROM play_history ph
     JOIN requests r ON r.id = ph.request_id
     ORDER BY ph.played_at DESC
     LIMIT 100`
  ).all();
  return jsonResponse({ history: result.results });
}, "onRequestGet");

// api/random-song.ts
function calcWeight(song, totals, todayMap, recentMap) {
  const posted = totals.get(song.student_id) ?? 1;
  const todayPlayed = todayMap.get(song.student_id) ?? 0;
  const recentPenalty = recentMap.get(song.student_id) ?? 0;
  const base = 1 / posted;
  const todayFactor = 1 / (1 + todayPlayed * 1.2);
  const recentFactor = Math.max(0.15, 1 - recentPenalty * 0.35);
  const replayFactor = song.play_count > 0 ? 1 / (1 + song.play_count * 0.5) : 1;
  return Math.max(1e-3, base * todayFactor * recentFactor * replayFactor);
}
__name(calcWeight, "calcWeight");
var onRequestGet2 = /* @__PURE__ */ __name(async ({ env }) => {
  const candidatesResult = await env.DB.prepare(
    `SELECT * FROM requests WHERE played = 0 ORDER BY created_at ASC`
  ).all();
  let candidates = candidatesResult.results ?? [];
  if (candidates.length === 0) {
    await env.DB.prepare("UPDATE requests SET played = 0, played_today = 0").run();
    const resetResult = await env.DB.prepare("SELECT * FROM requests ORDER BY created_at ASC").all();
    candidates = resetResult.results ?? [];
    if (candidates.length === 0) return jsonResponse({ error: "\u518D\u751F\u53EF\u80FD\u306A\u66F2\u304C\u3042\u308A\u307E\u305B\u3093\u3002" }, 404);
  }
  const [totalByStudentResult, todayByStudentResult, recentResult] = await Promise.all([
    env.DB.prepare("SELECT student_id, COUNT(*) AS c FROM requests GROUP BY student_id").all(),
    env.DB.prepare(
      `SELECT r.student_id, COUNT(ph.id) AS c
       FROM play_history ph
       JOIN requests r ON r.id = ph.request_id
       WHERE ph.played_at >= date('now')
       GROUP BY r.student_id`
    ).all(),
    env.DB.prepare(
      `SELECT r.student_id, COUNT(*) AS c
       FROM play_history ph
       JOIN requests r ON r.id = ph.request_id
       ORDER BY ph.played_at DESC
       LIMIT 5`
    ).all()
  ]);
  const totals = new Map(totalByStudentResult.results.map((x) => [x.student_id, Number(x.c)]));
  const todayMap = new Map(todayByStudentResult.results.map((x) => [x.student_id, Number(x.c)]));
  const recentMap = /* @__PURE__ */ new Map();
  for (const row of recentResult.results) {
    recentMap.set(row.student_id, (recentMap.get(row.student_id) ?? 0) + 1);
  }
  const selected = weightedPick(candidates, (song) => calcWeight(song, totals, todayMap, recentMap));
  if (!selected) return jsonResponse({ error: "\u9078\u66F2\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002" }, 500);
  return jsonResponse({
    id: selected.id,
    student_id: selected.student_id,
    title: selected.title,
    recommendation: selected.recommendation,
    youtube_id: selected.youtube_id,
    max_duration_sec: 300
  });
}, "onRequestGet");

// lib/student.ts
var STUDENTS = Array.from({ length: 40 }, (_, i) => `3A${String(i + 1).padStart(2, "0")}`);
function isValidStudentId(studentId) {
  return STUDENTS.includes(studentId);
}
__name(isValidStudentId, "isValidStudentId");

// api/request.ts
var onRequestPost2 = /* @__PURE__ */ __name(async ({ request, env }) => {
  try {
    const body = await request.json();
    const studentId = sanitizeText(body.student_id, 10);
    const title = sanitizeText(body.title, 120);
    const recommendation = sanitizeText(body.recommendation, 400);
    const youtubeUrl = sanitizeText(body.youtube_url, 500);
    if (!isValidStudentId(studentId)) return jsonResponse({ error: "\u5B66\u7C4D\u756A\u53F7\u304C\u4E0D\u6B63\u3067\u3059\u3002" }, 400);
    if (!title) return jsonResponse({ error: "\u66F2\u30BF\u30A4\u30C8\u30EB\u306F\u5FC5\u9808\u3067\u3059\u3002" }, 400);
    const youtubeId = extractYoutubeId(youtubeUrl);
    if (!youtubeId) return jsonResponse({ error: "YouTube URL\u5F62\u5F0F\u304C\u4E0D\u6B63\u3067\u3059\u3002" }, 400);
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const ua = sanitizeText(request.headers.get("user-agent") ?? "", 200);
    const rateHit = await env.DB.prepare(
      `SELECT 1 FROM request_rate_limit
       WHERE (student_id = ?1 OR ip_hash = ?2)
         AND created_at > datetime('now', '-30 seconds')
       LIMIT 1`
    ).bind(studentId, ip).first();
    if (rateHit) return jsonResponse({ error: "\u77ED\u6642\u9593\u3067\u306E\u9023\u7D9A\u6295\u7A3F\u306F\u3067\u304D\u307E\u305B\u3093\u300230\u79D2\u5F85\u3063\u3066\u304F\u3060\u3055\u3044\u3002" }, 429);
    const dup = await env.DB.prepare("SELECT id FROM requests WHERE youtube_id = ?1 LIMIT 1").bind(youtubeId).first();
    if (dup) return jsonResponse({ error: "\u540C\u3058\u52D5\u753B\u306F\u65E2\u306B\u6295\u7A3F\u6E08\u307F\u3067\u3059\u3002" }, 409);
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
    return jsonResponse({ ok: true, message: "\u6295\u7A3F\u5B8C\u4E86" }, 201);
  } catch {
    return jsonResponse({ error: "\u6295\u7A3F\u51E6\u7406\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002" }, 500);
  }
}, "onRequestPost");

// api/requests.ts
var onRequestGet3 = /* @__PURE__ */ __name(async ({ request, env }) => {
  const url = new URL(request.url);
  const unplayedOnly = url.searchParams.get("unplayedOnly") === "1";
  const where = unplayedOnly ? "WHERE played = 0" : "";
  const [listResult, statsResult, studentStats] = await Promise.all([
    env.DB.prepare(
      `SELECT id, student_id, title, recommendation, created_at, played, played_today, play_count
       FROM requests ${where}
       ORDER BY datetime(created_at) DESC
       LIMIT 200`
    ).all(),
    env.DB.prepare(
      `SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN played_today = 1 THEN 1 ELSE 0 END) AS today_played,
        SUM(CASE WHEN played = 0 THEN 1 ELSE 0 END) AS unplayed_count
       FROM requests`
    ).first(),
    env.DB.prepare(
      `SELECT student_id, COUNT(*) AS posted_count,
              SUM(CASE WHEN played = 1 THEN 1 ELSE 0 END) AS played_count
       FROM requests
       GROUP BY student_id
       ORDER BY posted_count DESC, student_id ASC`
    ).all()
  ]);
  return jsonResponse({
    requests: listResult.results,
    stats: statsResult,
    studentStats: studentStats.results
  });
}, "onRequestGet");

// api/song-played.ts
var onRequestPost3 = /* @__PURE__ */ __name(async ({ request, env }) => {
  const body = await request.json();
  const requestId = Number(body.request_id);
  if (!Number.isInteger(requestId) || requestId <= 0) return jsonResponse({ error: "request_id\u4E0D\u6B63" }, 400);
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
}, "onRequestPost");

// _middleware.ts
var MIME_TYPES = {
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
function getExt(path) {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}
__name(getExt, "getExt");
var onRequest = /* @__PURE__ */ __name(async (context) => {
  const response = await context.next();
  const headers = new Headers(response.headers);
  const security = cspHeaders();
  for (const [k, v] of Object.entries(security)) headers.set(k, v);
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
}, "onRequest");

// ../.wrangler/tmp/pages-uhugQP/functionsRoutes-0.9562958571650375.mjs
var routes = [
  {
    routePath: "/api/admin-reset",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/history",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/random-song",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/request",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/requests",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/song-played",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/",
    mountPath: "/",
    method: "",
    middlewares: [onRequest],
    modules: []
  }
];

// ../node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-CeDV8n/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-CeDV8n/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.25594106952481666.mjs.map
