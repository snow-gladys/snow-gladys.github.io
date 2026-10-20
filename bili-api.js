/* 思诺 / 心宜播放器共用的 BV 输入与接口处理。 */
(function (global) {
    'use strict';

    // 旧 BV 键保持不变；分 P / 片段使用独立键，收藏、歌词、缓存和续播不会互相覆盖。
    function source(value) {
        var match = /^(BV[a-zA-Z0-9]{10})(?:@p([1-9]\d{0,3}))?(?:@t(\d+(?:\.\d{1,3})?)-(\d+(?:\.\d{1,3})?))?$/i.exec(String(value || '').trim());
        if (!match) return null;
        var start = Number(match[3] || 0), end = Number(match[4] || 0);
        if (start > 604800 || end > 604800 || end && end <= start) return null;
        return { bvid: 'BV' + match[1].slice(2), page: Number(match[2] || 1), start: start, end: end };
    }
    function trackId(value, page, start, end) {
        var item = source(value);
        if (!item) return '';
        page = page == null ? item.page : Number(page);
        start = start == null ? item.start : Number(start); end = end == null ? item.end : Number(end);
        if (!Number.isInteger(page) || page < 1 || page > 9999 || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) return '';
        var key = item.bvid + (page > 1 ? '@p' + page : '') + (start || end ? '@t' + Math.round(start * 1000) / 1000 + '-' + Math.round(end * 1000) / 1000 : '');
        return source(key) ? key : '';
    }
    function normalizeId(value) { return trackId(value); }
    function videoQuery(value) {
        var item = source(value);
        if (!item) throw new Error('请输入有效的 BV 号。');
        return 'bvid=' + encodeURIComponent(item.bvid) + (item.page > 1 ? '&p=' + item.page : '');
    }
    function videoUrl(value) {
        var item = source(value);
        return item ? 'https://www.bilibili.com/video/' + item.bvid + (item.page > 1 || item.start ? '/?' + (item.page > 1 ? 'p=' + item.page + (item.start ? '&' : '') : '') + (item.start ? 't=' + item.start : '') : '') : '';
    }
    function inputValue(value) {
        var item = source(value);
        return item && (item.page > 1 || item.start || item.end) ? videoUrl(value) + (item.end ? (item.page > 1 || item.start ? '&' : '/?') + 'end=' + item.end : '') : normalizeId(value);
    }
    function time(value) {
        var text = String(value || '').trim();
        if (!text) return 0;
        if (/^\d+(?:\.\d{1,3})?$/.test(text)) return Number(text);
        if (!/^\d{1,5}:\d{1,2}(?::\d{1,2})?(?:\.\d{1,3})?$/.test(text)) return NaN;
        var pieces = text.split(':').map(Number);
        if (pieces.slice(1).some(function (part) { return part >= 60; })) return NaN;
        return pieces.reduce(function (sum, part) { return sum * 60 + part; }, 0);
    }
    function videoInput(value) {
        var text = String(value || '').trim().replace(/&amp;/g, '&');
        if (/^BV[a-zA-Z0-9]{10}[?]/i.test(text)) text = 'https://www.bilibili.com/video/' + text;
        var direct = normalizeId(text);
        if (direct) return { bvid: direct, shortUrl: '' };
        // 从整段分享文案提取 URL，标点不会被误当成短链路径的一部分。
        var links = text.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)?(?:bilibili\.com|b23\.tv)\/[^\s<>"'，。！？；、）】]+/ig) || [];
        for (var link of links) {
            try {
                link = link.replace(/[.,;!?)\]}]+$/, '');
                var url = new URL(/^https?:\/\//i.test(link) ? link : 'https://' + link);
                var offset = text.indexOf(link);
                if (offset > 0 && /[a-zA-Z0-9./_-]/.test(text[offset - 1])) continue;
                if (url.username || url.password || url.port) continue;
                if (url.hostname === 'b23.tv' && /^\/[a-zA-Z0-9]{1,32}\/?$/.test(url.pathname)) {
                    var query = ['p', 't'].filter(function (param) { return url.searchParams.has(param); }).map(function (param) { return param + '=' + encodeURIComponent(url.searchParams.get(param)); }).join('&');
                    return { bvid: '', shortUrl: 'https://b23.tv' + url.pathname + (query ? '?' + query : '') };
                }
                if (url.hostname !== 'bilibili.com' && !url.hostname.endsWith('.bilibili.com')) continue;
                var match = /^\/video\/(BV[a-zA-Z0-9]{10})(?:\/|$)/i.exec(url.pathname);
                if (!match) continue;
                var page = url.searchParams.has('p') ? Number(url.searchParams.get('p')) : 1;
                var start = time(url.searchParams.get('t') || '0');
                var end = time(url.searchParams.get('end') || '0');
                var key = trackId(match[1], page, start, end);
                if (key) return { bvid: key, shortUrl: '' };
            } catch (_) {}
        }
        var bare = /(?:^|[\s【（(:：])(BV[a-zA-Z0-9]{10})(?![a-zA-Z0-9@])/i.exec(text);
        return { bvid: bare ? normalizeId(bare[1]) : '', shortUrl: '' };
    }

    function favoriteId(value) {
        var text = String(value || '').trim();
        var id = /^(?:ml)?([1-9]\d{0,19})$/i.exec(text);
        if (id) return id[1];
        try {
            var url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text);
            if (!['space.bilibili.com', 'www.bilibili.com', 'bilibili.com'].includes(url.hostname)) return '';
            var path = /^\/(?:medialist\/detail|list)\/ml(\d+)(?:\/|$)/.exec(url.pathname);
            var candidate = url.searchParams.get('fid') || url.searchParams.get('media_id') || (path && path[1]) || '';
            return /^[1-9]\d{0,19}$/.test(candidate) ? candidate : '';
        } catch (_) { return ''; }
    }

    function mergeCustomSongs(existing, incoming) {
        var keys = new Set(existing.map(function (song) { return normalizeId(song.bvid); }).filter(Boolean));
        var added = [];
        incoming.forEach(function (song) {
            var id = normalizeId(song.bvid);
            var name = String(song.name || '').trim();
            if (!id || !name || keys.has(id)) return;
            keys.add(id);
            added.push({ name: name, bvid: id });
        });
        return { songs: existing.concat(added), added: added.length };
    }

    function createClient(base) {
        base = String(base || '').replace(/\/+$/, '');
        var pending = new Map();
        var infoCache = new Map();
        function request(path) {
            if (pending.has(path)) return pending.get(path);
            var result = performRequest(path).finally(function () { pending.delete(path); });
            pending.set(path, result);
            return result;
        }
        async function performRequest(path, options) {
            var response;
            try {
                response = await fetch(base + path, options);
            } catch (error) {
                if (error && error.name === 'AbortError') throw error;
                throw new Error('暂时无法连接音频服务，请检查网络后重试。');
            }
            var data;
            try {
                data = await response.json();
            } catch (error) {
                if (error && error.name === 'AbortError') throw error;
                throw new Error('音频服务返回异常，请稍后重试。');
            }
            if (!response.ok || !data || data.error) {
                var error = new Error(data && typeof data.error === 'string' ? data.error : '音频服务暂时不可用，请稍后重试。');
                error.code = data && data.code;
                error.status = response.status;
                throw error;
            }
            return data;
        }
        return {
            videoInfo: async function (input, options) {
                var parsed = videoInput(input), key = parsed.bvid || parsed.shortUrl;
                if (!key) throw new Error('请输入 BV 号，或粘贴 B 站视频分享链接。');
                var cached = infoCache.get(key);
                if (cached && cached.expires > Date.now()) return cached.song;
                var path = '/info?' + (parsed.bvid ? videoQuery(parsed.bvid) : 'url=' + encodeURIComponent(parsed.shortUrl));
                var data = await (options && options.signal ? performRequest(path, options) : request(path));
                var item = source(data.bvid), name = typeof data.name === 'string' ? data.name.trim() : '';
                if (!item || !name) throw new Error('未获取到视频标题，请手动填写歌名。');
                var requested = parsed.bvid && source(parsed.bvid);
                var page = requested ? requested.page : Number(data.page || 1);
                var id = trackId(item.bvid, page, requested ? requested.start : Number(data.start || 0), requested ? requested.end : 0);
                if (!id) throw new Error('分享链接中的分 P 或时间无效。');
                var song = { bvid: id, name: name.slice(0, 300) };
                if (Array.isArray(data.pages)) song.pages = data.pages;
                if (typeof data.chaptersAvailable === 'boolean') song.chaptersAvailable = data.chaptersAvailable;
                if (infoCache.size >= 128) infoCache.delete(infoCache.keys().next().value);
                var entry = { song: song, expires: Date.now() + 10 * 60 * 1000 };
                infoCache.set(key, entry); infoCache.set(id, entry);
                return song;
            },
            chapters: async function (id, options) {
                var data = await performRequest('/chapters?' + videoQuery(id), options);
                if (!Array.isArray(data.chapters)) throw new Error('章节读取失败，可以手动填写起止时间。');
                return data;
            },
            loadFavorites: async function (input, options) {
                options = options || {};
                var id = favoriteId(input);
                if (!id) throw new Error('请粘贴包含 fid 的 B 站收藏夹链接，或收藏夹编号。');
                var items = [], seen = new Set(), scanned = 0, skipped = 0, duplicateCount = 0;
                var title = '', owner = '', total = 0;
                for (var page = 1; page <= 500; page++) {
                    if (options.signal && options.signal.aborted) throw new DOMException('已取消读取', 'AbortError');
                    var data = await performRequest('/favorites?media_id=' + id + '&pn=' + page, { signal: options.signal });
                    if (!Array.isArray(data.items) || typeof data.hasMore !== 'boolean' || data.page !== page ||
                        !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.scanned) || data.scanned < 0) {
                        throw new Error('收藏夹数据不完整，请稍后重新读取。');
                    }
                    if (page === 1) { title = data.title || '公开收藏夹'; owner = data.owner || ''; total = data.total; }
                    else if (data.total !== total) throw new Error('收藏夹内容在读取时发生了变化，请重新读取。');
                    scanned += data.scanned;
                    skipped += Number(data.skipped) || 0;
                    var uniqueOnPage = 0;
                    data.items.forEach(function (song) {
                        var bvid = normalizeId(song.bvid);
                        if (!bvid || typeof song.name !== 'string' || !song.name.trim()) { skipped++; return; }
                        if (seen.has(bvid)) { duplicateCount++; return; }
                        seen.add(bvid);
                        uniqueOnPage++;
                        items.push({ name: song.name, bvid: bvid, duration: song.duration || 0, author: song.author || '' });
                    });
                    if (options.onProgress) options.onProgress({ page: page, total: total, scanned: scanned, found: items.length });
                    if (!data.hasMore) {
                        if (scanned < total) throw new Error('收藏夹读取不完整，请稍后重新读取。');
                        return { mediaId: id, title: title, owner: owner, total: total, items: items, skipped: skipped, duplicateCount: duplicateCount };
                    }
                    if (!data.scanned || (data.items.length && !uniqueOnPage)) throw new Error('收藏夹分页出现重复或缺失，请稍后重新读取。');
                }
                throw new Error('收藏夹超过一次可读取的范围，请拆分收藏夹后再导入。');
            },
            validate: async function (id) {
                if (!normalizeId(id)) return 'invalid';
                var data = await request('/valid?' + videoQuery(id));
                return data.valid === true ? 'valid' : data.valid === false ? 'invalid' : 'unknown';
            },
            resolve: async function (id, mode, html, options) {
                var path = (html ? '/resolvehtml?' : '/resolve?') + videoQuery(id) + '&mode=' + encodeURIComponent(mode || 'medium');
                var data = await (options && options.signal ? performRequest(path, options) : request(path));
                if (typeof data.url !== 'string' || !/^https:\/\//i.test(data.url)) {
                    throw new Error('未获取到可用的音频地址，请稍后重试。');
                }
                var hls = data.hls;
                var hlsUrl = hls && /^0-\d+$/.test(hls.initialization || '') && /^\d+-\d+$/.test(hls.indexRange || '')
                    ? base + '/hls.m3u8?url=' + encodeURIComponent(data.url) + '&init=' + encodeURIComponent(hls.initialization) + '&index=' + encodeURIComponent(hls.indexRange) : null;
                return {
                    url: data.url,
                    proxyUrl: base + '/proxy?url=' + encodeURIComponent(data.url),
                    hlsUrl: hlsUrl,
                };
            },
        };
    }

    global.SG_BILI_API = { source: source, trackId: trackId, videoUrl: videoUrl, inputValue: inputValue, time: time, normalizeId: normalizeId, videoInput: videoInput, videoQuery: videoQuery, favoriteId: favoriteId, mergeCustomSongs: mergeCustomSongs, createClient: createClient };
})(window);
