/* 思诺 / 心宜播放器共用的 BV 输入与接口处理。 */
(function (global) {
    'use strict';

    function normalizeId(value) {
        var text = String(value || '').trim();
        if (/^BV[a-zA-Z0-9]{10}$/i.test(text)) return 'BV' + text.slice(2);
        return '';
    }

    function videoQuery(value) {
        var id = normalizeId(value);
        if (!id) throw new Error('请输入有效的 BV 号。');
        return 'bvid=' + encodeURIComponent(id);
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
            resolve: async function (id, mode, html) {
                var data = await request((html ? '/resolvehtml?' : '/resolve?') + videoQuery(id) + '&mode=' + encodeURIComponent(mode || 'medium'));
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

    global.SG_BILI_API = { normalizeId: normalizeId, videoQuery: videoQuery, favoriteId: favoriteId, mergeCustomSongs: mergeCustomSongs, createClient: createClient };
})(window);
