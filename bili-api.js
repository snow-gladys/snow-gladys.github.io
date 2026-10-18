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

    function createClient(base) {
        base = String(base || '').replace(/\/+$/, '');
        var pending = new Map();
        function request(path) {
            if (pending.has(path)) return pending.get(path);
            var result = performRequest(path).finally(function () { pending.delete(path); });
            pending.set(path, result);
            return result;
        }
        async function performRequest(path) {
            var response;
            try {
                response = await fetch(base + path);
            } catch (_) {
                throw new Error('暂时无法连接音频服务，请检查网络后重试。');
            }
            var data;
            try {
                data = await response.json();
            } catch (_) {
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
                return {
                    url: data.url,
                    proxyUrl: base + '/proxy?url=' + encodeURIComponent(data.url),
                };
            },
        };
    }

    global.SG_BILI_API = { normalizeId: normalizeId, videoQuery: videoQuery, createClient: createClient };
})(window);
