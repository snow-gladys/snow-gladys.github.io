/**
 * 腾讯云 EdgeOne 边缘函数：将本文件全部复制到现有函数中，替换后保存并部署。
 * 无依赖，无需 Cookie；保留播放接口，新增 /favorites 读取公开收藏夹。
 *
 * GET /resolve?bvid=BV17uZQBHEDo&mode=medium
 * GET /resolve?bvid=BV17uZQBHEDo&p=1&mode=high
 * GET /valid?bvid=BV17uZQBHEDo
 * GET /info?bvid=BV17uZQBHEDo 或 /info?url=https%3A%2F%2Fb23.tv%2Fxxxx
 * GET /favorites?media_id=3736153875&pn=1 （每页 20 项）
 * /hls.m3u8 将 DASH 音频索引转换为原生 HLS 播放列表，不转码。
 * /resolvehtml 与 /resolve 使用相同的独立音频解析逻辑。
 *
 * 单实例缓存 CID / 分 P 信息 10 分钟、分段索引 1 分钟；音频地址每次重新解析。
 * 接口或出口请求仍可能受到 B 站限制；失败时返回结构化错误，不自动重试。
 */
const ALLOWED_ORIGINS = new Set([
  "https://snow-gladys.com",
  "https://www.snow-gladys.com",
  "https://snow-gladys.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);
const BILI_HEADERS = {
  Referer: "https://www.bilibili.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};
const PAGE_CACHE = new Map();
const PAGE_REQUESTS = new Map();
const PAGE_CACHE_TTL = 10 * 60 * 1000;
const HLS_INDEX_CACHE = new Map();
const HLS_INDEX_REQUESTS = new Map();
const VIDEO_INFO_CACHE = new Map();
const VIDEO_INFO_REQUESTS = new Map();

class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeVideoId(value) {
  const text = String(value || "").trim();
  if (/^BV[a-zA-Z0-9]{10}$/i.test(text)) return "BV" + text.slice(2);
  return null;
}

function videoParams(id) {
  return new URLSearchParams({ bvid: id });
}

async function shortVideoId(input) {
  let url;
  try { url = new URL(input); } catch (_) {}
  if (!url || url.protocol !== 'https:' || url.hostname !== 'b23.tv' || url.port || url.username || url.password ||
      !/^\/[a-zA-Z0-9]{1,32}\/?$/.test(url.pathname)) {
    throw new ApiError(400, 'INVALID_SHARE_URL', '请粘贴有效的 B 站视频分享链接。');
  }
  for (let i = 0; i < 4; i++) {
    let response;
    try { response = await fetch(url.href, { headers: BILI_HEADERS, redirect: 'manual' }); }
    catch (_) { throw new ApiError(502, 'SHARE_NETWORK_ERROR', '分享链接暂时无法打开，请重试或直接填写 BV 号。'); }
    const location = response.headers.get('Location');
    if (response.body) await response.body.cancel().catch(() => {});
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
    try { url = new URL(location, url); } catch (_) { break; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !(url.hostname === 'b23.tv' || url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com'))) break;
    const match = /^\/video\/(BV[a-zA-Z0-9]{10})(?:\/|$)/i.exec(url.pathname);
    if (match && url.hostname !== 'b23.tv') return normalizeVideoId(match[1]);
    if (url.hostname !== 'b23.tv') break;
  }
  throw new ApiError(422, 'SHARE_VIDEO_NOT_FOUND', '分享链接中未找到视频，请复制视频页链接或 BV 号。');
}

async function getVideoInfo(id) {
  const cached = VIDEO_INFO_CACHE.get(id);
  if (cached && cached.expires > Date.now()) return cached.song;
  if (VIDEO_INFO_REQUESTS.has(id)) return VIDEO_INFO_REQUESTS.get(id);
  const pending = (async () => {
    const result = await biliJson('/x/web-interface/view', videoParams(id), 'info');
    const data = result.data, bvid = data && normalizeVideoId(data.bvid);
    const name = data && typeof data.title === 'string' ? data.title.trim() : '';
    if (!bvid || !name) throw new ApiError(502, 'UPSTREAM_INVALID_DATA', '未获取到视频标题，请稍后重试。', { stage: 'info' });
    const song = { bvid, name: name.slice(0, 300) };
    if (VIDEO_INFO_CACHE.size >= 256) VIDEO_INFO_CACHE.delete(VIDEO_INFO_CACHE.keys().next().value);
    VIDEO_INFO_CACHE.set(id, { song, expires: Date.now() + PAGE_CACHE_TTL });
    return song;
  })();
  VIDEO_INFO_REQUESTS.set(id, pending);
  try { return await pending; } finally { VIDEO_INFO_REQUESTS.delete(id); }
}

async function biliJson(path, params, stage) {
  let response;
  try {
    response = await fetch("https://api.bilibili.com" + path + "?" + params, {
      headers: BILI_HEADERS,
    });
  } catch (_) {
    throw new ApiError(502, "UPSTREAM_NETWORK_ERROR", "暂时无法连接 B 站，请稍后重试。", { stage });
  }
  const details = { stage, upstreamStatus: response.status };
  if ([403, 412, 429].includes(response.status)) {
    throw new ApiError(503, "BILI_RISK_CONTROL", "B 站暂时拒绝了访问请求，请稍后重试。", details);
  }
  if (!response.ok) {
    throw new ApiError(502, "UPSTREAM_HTTP_ERROR", "B 站接口暂时不可用，请稍后重试。", details);
  }
  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw new ApiError(502, "UPSTREAM_INVALID_JSON", "B 站返回了异常页面，请稍后重试。", details);
  }
  if (!data || typeof data.code !== "number") {
    throw new ApiError(502, "UPSTREAM_INVALID_DATA", "B 站返回的数据格式异常。", details);
  }
  if (data.code !== 0) {
    details.upstreamCode = data.code;
    if ([-412, -352, -401, -509, -799].includes(data.code)) {
      throw new ApiError(503, "BILI_RISK_CONTROL", "B 站暂时限制了访问，请稍后重试。", details);
    }
    if (data.code === -404) {
      if (stage === "favorites") throw new ApiError(404, "FAVORITE_NOT_FOUND", "收藏夹不存在或已被删除。", details);
      throw new ApiError(404, "VIDEO_NOT_FOUND", "视频不存在或已被删除。", details);
    }
    if (stage === "favorites" && [-403, -101, 11003].includes(data.code)) {
      throw new ApiError(403, "FAVORITE_NOT_PUBLIC", "无法读取该收藏夹，请确认它已设为公开。", details);
    }
    throw new ApiError(502, "BILI_API_ERROR", "B 站暂时无法提供该内容。", details);
  }
  return data;
}

async function getPages(id) {
  const cached = PAGE_CACHE.get(id);
  if (cached && cached.expires > Date.now()) return cached.pages;
  PAGE_CACHE.delete(id);
  if (PAGE_REQUESTS.has(id)) return PAGE_REQUESTS.get(id);
  const pending = (async () => {
    const result = await biliJson("/x/player/pagelist", videoParams(id), "pagelist");
    const pages = result.data;
    if (!Array.isArray(pages) || !pages.length || !pages.every(p => p && p.cid && p.page)) {
      throw new ApiError(502, "UPSTREAM_INVALID_DATA", "B 站未返回可用的分 P 信息。", { stage: "pagelist" });
    }
    if (PAGE_CACHE.size >= 256) PAGE_CACHE.delete(PAGE_CACHE.keys().next().value);
    PAGE_CACHE.set(id, { pages, expires: Date.now() + PAGE_CACHE_TTL });
    return pages;
  })();
  PAGE_REQUESTS.set(id, pending);
  try {
    return await pending;
  } finally {
    PAGE_REQUESTS.delete(id);
  }
}

function chooseAudio(mode, list) {
  const preferences = {
    low: [30216, 30232, 30280],
    medium: [30232, 30280, 30216],
    high: [30280, 30232, 30216],
  };
  for (const id of preferences[mode]) {
    const audio = list.find(item => Number(item.id) === id);
    if (audio) return audio;
  }
  const sorted = list.slice().sort((a, b) => (Number(a.bandwidth) || 0) - (Number(b.bandwidth) || 0));
  return mode === "low" ? sorted[0] : sorted[sorted.length - 1];
}

function mediaUrl(value) {
  let target;
  try { target = new URL(value); } catch (_) { /* handled below */ }
  const host = target && target.hostname;
  const allowed = host && (
    host === "bilivideo.com" || host.endsWith(".bilivideo.com") ||
    host === "bilivideo.cn" || host.endsWith(".bilivideo.cn") ||
    /^upos-[a-z0-9-]+\.akamaized\.net$/.test(host)
  );
  if (!allowed || target.protocol !== "https:" || target.username || target.password || (target.port && target.port !== "443")) {
    throw new ApiError(400, "INVALID_MEDIA_URL", "音频地址必须是受支持的 B 站 HTTPS 媒体地址。");
  }
  return target;
}

async function proxyMedia(request, targetValue, corsHeaders) {
  if (!targetValue) throw new ApiError(400, "MISSING_URL", "缺少音频地址。");
  let target = mediaUrl(targetValue);
  const headers = new Headers(BILI_HEADERS);
  for (const name of ["Range", "If-Range", "If-None-Match", "If-Modified-Since"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    try {
      response = await fetch(target.toString(), { method: request.method, headers, redirect: "manual" });
    } catch (_) {
      throw new ApiError(502, "MEDIA_NETWORK_ERROR", "暂时无法读取音频，请稍后重试。", { stage: "proxy" });
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("Location");
    if (!location || redirects === 3) {
      throw new ApiError(502, "MEDIA_REDIRECT_ERROR", "音频地址跳转异常。", { stage: "proxy" });
    }
    target = mediaUrl(new URL(location, target).toString());
  }
  if (!response.ok && ![304, 416].includes(response.status)) {
    throw new ApiError(502, "MEDIA_UPSTREAM_ERROR", "音频地址已失效或暂时无法访问，请重新播放。", {
      stage: "proxy", upstreamStatus: response.status,
    });
  }
  const outgoing = new Headers(corsHeaders);
  for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Cache-Control"]) {
    const value = response.headers.get(name);
    if (value !== null) outgoing.set(name, value);
  }
  if (response.status === 206 && /^bytes \d+-\d+\/\d+$/.test(outgoing.get("Content-Range") || "")) outgoing.set("Accept-Ranges", "bytes");
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status, headers: outgoing,
  });
}

function parseAudioIndex(buffer, indexStart) {
  const view = new DataView(buffer);
  let pos = 0;
  function invalid() { throw new ApiError(502, "INVALID_AUDIO_INDEX", "该音频暂不支持分段播放，请使用普通播放。", { stage: "hls" }); }
  function uint64(offset) {
    const value = view.getUint32(offset) * 4294967296 + view.getUint32(offset + 4);
    if (!Number.isSafeInteger(value)) invalid();
    return value;
  }
  while (pos + 8 <= view.byteLength) {
    const size = view.getUint32(pos);
    if (size < 8 || pos + size > view.byteLength) invalid();
    const type = String.fromCharCode(...new Uint8Array(buffer, pos + 4, 4));
    if (type === "sidx") {
      if (size < 32) invalid();
      const version = view.getUint8(pos + 8), scale = view.getUint32(pos + 16);
      if (![0, 1].includes(version) || !scale || (version === 1 && size < 40)) invalid();
      const count = view.getUint16(pos + (version === 0 ? 30 : 38));
      let ref = pos + (version === 0 ? 32 : 40);
      if (!count || count > 20000 || ref + count * 12 > pos + size) invalid();
      let offset = indexStart + pos + size + (version === 0 ? view.getUint32(pos + 24) : uint64(pos + 28));
      const segments = [];
      for (let i = 0; i < count; i++, ref += 12) {
        const reference = view.getUint32(ref), length = reference & 0x7fffffff;
        const duration = view.getUint32(ref + 4) / scale;
        if (reference >>> 31 || !length || !duration || !Number.isSafeInteger(offset + length)) invalid();
        segments.push({ offset, length, duration }); offset += length;
      }
      return segments;
    }
    pos += size;
  }
  invalid();
}

async function hlsPlaylist(request, url, corsHeaders) {
  const target = mediaUrl(url.searchParams.get("url"));
  function range(value) {
    const match = /^(\d+)-(\d+)$/.exec(value || "");
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < Number(match[1])) {
      throw new ApiError(400, "INVALID_AUDIO_RANGE", "音频索引范围无效。");
    }
    return { start: Number(match[1]), end: Number(match[2]) };
  }
  const init = range(url.searchParams.get("init")), index = range(url.searchParams.get("index"));
  const length = index.end - index.start + 1;
  if (init.start !== 0 || init.end >= index.start || index.end > 1024 * 1024 || length > 256 * 1024) {
    throw new ApiError(400, "INVALID_AUDIO_RANGE", "音频索引范围无效。");
  }
  const key = target + "|" + index.start + "-" + index.end;
  const cached = HLS_INDEX_CACHE.get(key);
  let segments = cached && cached.expires > Date.now() ? cached.segments : null;
  if (!segments) {
    let pending = HLS_INDEX_REQUESTS.get(key);
    if (!pending) {
      pending = (async () => {
        const headers = new Headers(request.headers);
        headers.set("Range", "bytes=" + index.start + "-" + index.end);
        headers.delete("If-Range"); headers.delete("If-None-Match"); headers.delete("If-Modified-Since");
        const response = await proxyMedia(new Request(request.url, { method: "GET", headers }), target.toString(), corsHeaders);
        const expected = new RegExp("^bytes " + index.start + "-" + index.end + "/(\\d+)$").exec(response.headers.get("Content-Range") || "");
        if (response.status !== 206 || !expected || Number(expected[1]) <= index.end) {
          if (response.body) await response.body.cancel();
          throw new ApiError(502, "INVALID_AUDIO_INDEX", "音频索引读取失败，请使用普通播放。", { stage: "hls" });
        }
        const contentLength = response.headers.get("Content-Length");
        if (contentLength !== null && Number(contentLength) !== length) {
          if (response.body) await response.body.cancel();
          throw new ApiError(502, "INVALID_AUDIO_INDEX", "音频索引长度异常。");
        }
        // 索引已限制在 256 KiB 内，小于 EdgeOne arrayBuffer() 的 1 MiB 上限。
        // 使用运行时提供的二进制读取方法，避免依赖流块类型和结束状态差异。
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== length) throw new ApiError(502, "INVALID_AUDIO_INDEX", "音频索引不完整。");
        const parsed = parseAudioIndex(buffer, index.start);
        if (parsed.some(item => item.offset + item.length > Number(expected[1]))) throw new ApiError(502, "INVALID_AUDIO_INDEX", "音频分段超出文件范围。");
        if (HLS_INDEX_CACHE.size >= 32) HLS_INDEX_CACHE.delete(HLS_INDEX_CACHE.keys().next().value);
        HLS_INDEX_CACHE.set(key, { segments: parsed, expires: Date.now() + 60000 });
        return parsed;
      })().finally(() => HLS_INDEX_REQUESTS.delete(key));
      HLS_INDEX_REQUESTS.set(key, pending);
    }
    segments = await pending;
  }
  const proxy = new URL("/proxy", url);
  proxy.searchParams.set("url", target.toString());
  const text = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-TARGETDURATION:" + Math.ceil(Math.max(...segments.map(item => item.duration))), "#EXT-X-MEDIA-SEQUENCE:0",
    '#EXT-X-MAP:URI="' + proxy + '",BYTERANGE="' + (init.end + 1) + '@0"',
    ...segments.flatMap(item => ["#EXTINF:" + item.duration.toFixed(6) + ",", "#EXT-X-BYTERANGE:" + item.length + "@" + item.offset, proxy.toString()]),
    "#EXT-X-ENDLIST", ""].join("\n");
  return new Response(request.method === "HEAD" ? null : text, { headers: {
    ...corsHeaders, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store",
  } });
}

async function handleRequest(request) {
  const origin = request.headers.get("Origin");
  const allowed = ALLOWED_ORIGINS.has(origin);
  const corsHeaders = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range, If-Range, If-None-Match, If-Modified-Since",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
    "Access-Control-Max-Age": "86400",
  };
  if (allowed) corsHeaders["Access-Control-Allow-Origin"] = origin;
  function json(data, status = 200) {
    return new Response(request.method === "HEAD" ? null : JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (origin && !allowed) return json({ code: "FORBIDDEN_ORIGIN", error: "当前网站未被允许访问。" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (!["GET", "HEAD"].includes(request.method)) return json({ code: "METHOD_NOT_ALLOWED", error: "仅支持 GET、HEAD 和 OPTIONS 请求。" }, 405);
  try {
    const url = new URL(request.url);
    if (url.pathname === '/info') {
      const id = url.searchParams.has('bvid') ? normalizeVideoId(url.searchParams.get('bvid')) : await shortVideoId(url.searchParams.get('url'));
      if (!id) throw new ApiError(400, 'INVALID_VIDEO_ID', '请输入有效的 BV 号。');
      return json(await getVideoInfo(id));
    }
    if (url.pathname === "/proxy") return await proxyMedia(request, url.searchParams.get("url"), corsHeaders);
    if (url.pathname === "/hls.m3u8") return await hlsPlaylist(request, url, corsHeaders);
    if (url.pathname === "/favorites") {
      const mediaId = url.searchParams.get("media_id") || "";
      const pn = url.searchParams.get("pn") || "1";
      if (!/^[1-9]\d{0,19}$/.test(mediaId)) throw new ApiError(400, "INVALID_FAVORITE_ID", "请输入有效的收藏夹链接或编号。");
      if (!/^[1-9]\d*$/.test(pn) || Number(pn) > 500) throw new ApiError(400, "INVALID_PAGE", "收藏夹页码无效。");
      const result = await biliJson("/x/v3/fav/resource/list", new URLSearchParams({
        media_id: mediaId, pn, ps: "20", platform: "web", order: "mtime", type: "0",
      }), "favorites");
      const data = result.data;
      if (!data || !data.info || !Number.isSafeInteger(data.info.media_count) || data.info.media_count < 0 ||
          (data.medias !== null && !Array.isArray(data.medias)) || typeof data.has_more !== "boolean") {
        throw new ApiError(502, "UPSTREAM_INVALID_DATA", "收藏夹返回的数据不完整，请稍后重试。", { stage: "favorites" });
      }
      const records = data.medias || [];
      const items = [];
      let skipped = 0;
      for (const item of records) {
        const bvid = item && normalizeVideoId(item.bvid || item.bv_id);
        const name = item && typeof item.title === "string" ? item.title.trim() : "";
        if (!item || item.type !== 2 || !bvid || !name || Number(item.attr || 0) !== 0) { skipped++; continue; }
        items.push({
          name, bvid,
          duration: Number.isFinite(item.duration) && item.duration >= 0 ? item.duration : 0,
          author: item.upper && typeof item.upper.name === "string" ? item.upper.name : "",
        });
      }
      return json({
        mediaId, title: String(data.info.title || "公开收藏夹"),
        owner: data.info.upper && String(data.info.upper.name || ""),
        total: data.info.media_count, page: Number(pn), hasMore: data.has_more,
        scanned: records.length, skipped, items,
      });
    }
    if (url.pathname === "/fans") {
      const vmid = url.searchParams.get("vmid") || "";
      if (!/^[1-9]\d*$/.test(vmid)) throw new ApiError(400, "INVALID_VMID", "请输入有效的用户 ID。");
      return json(await biliJson("/x/relation/stat", new URLSearchParams({ vmid }), "fans"));
    }
    if (!["/resolve", "/resolvehtml", "/valid"].includes(url.pathname)) {
      return json({ code: "NOT_FOUND", error: "接口不存在。" }, 404);
    }
    const id = normalizeVideoId(url.searchParams.get("bvid"));
    if (!id) {
      if (url.pathname === "/valid") return json({ valid: false });
      throw new ApiError(400, "INVALID_VIDEO_ID", "请输入有效的 BV 号。");
    }
    const pageText = url.searchParams.get("p") || "1";
    if (!/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(Number(pageText))) {
      throw new ApiError(400, "INVALID_PAGE", "分 P 序号必须是正整数。");
    }
    const pages = await getPages(id);
    const page = pages.find(item => Number(item.page) === Number(pageText));
    if (!page) {
      if (url.pathname === "/valid") return json({ valid: false, id });
      throw new ApiError(404, "PAGE_NOT_FOUND", "视频不存在该分 P。");
    }
    if (url.pathname === "/valid") return json({ valid: true, id, cid: page.cid, page: page.page });
    const mode = url.searchParams.get("mode") || "medium";
    if (!["low", "medium", "high"].includes(mode)) throw new ApiError(400, "INVALID_MODE", "音质只能是 low、medium 或 high。");
    const params = videoParams(id);
    params.set("cid", String(page.cid));
    params.set("fnval", "16");
    const play = await biliJson("/x/player/playurl", params, "playurl");
    const audios = play.data && play.data.dash && play.data.dash.audio;
    const usable = Array.isArray(audios) ? audios.filter(item => item && (item.baseUrl || item.base_url)) : [];
    if (!usable.length) throw new ApiError(422, "NO_AUDIO", "该视频暂时没有可用的独立音频。", { stage: "playurl" });
    const audio = chooseAudio(mode, usable);
    const segmentBase = audio.SegmentBase || audio.segment_base || {};
    const initialization = segmentBase.Initialization || segmentBase.initialization;
    const indexRange = segmentBase.indexRange || segmentBase.index_range;
    return json({
      url: audio.baseUrl || audio.base_url,
      id, cid: page.cid, page: page.page, mode,
      audioId: audio.id, mimeType: audio.mimeType || audio.mime_type || "audio/mp4",
      ...(/^0-\d+$/.test(initialization || "") && /^\d+-\d+$/.test(indexRange || "") ? { hls: { initialization, indexRange } } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const path = new URL(request.url).pathname;
      if (path === "/valid" && error.code === "VIDEO_NOT_FOUND") return json({ valid: false });
      return json({
        ...(path === "/valid" ? { valid: null } : {}),
        code: error.code, error: error.message, ...error.details,
      }, error.status);
    }
    console.error("Bilibili edge function error:", error);
    return json({ code: "INTERNAL_ERROR", error: "音频服务出现异常，请稍后重试。" }, 500);
  }
}

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
