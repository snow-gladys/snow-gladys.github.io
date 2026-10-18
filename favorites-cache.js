(function (root) {
    'use strict';
    function create(options) {
        let items = [], state = 'idle', message = '', mode = 'medium', controller = null, running = false, generation = 0, consecutiveFailures = 0;
        function snapshot() {
            return { state, message, mode, items: items.map(item => ({ ...item })), total: items.length,
                done: items.filter(item => item.status === 'done').length,
                failed: items.filter(item => item.status === 'failed').length };
        }
        function emit() {
            const value = snapshot();
            try { if (options.storage) options.storage.setItem(options.key, JSON.stringify(value)); } catch (_) {}
            if (options.onChange) options.onChange(value);
        }
        try {
            const saved = options.storage && JSON.parse(options.storage.getItem(options.key));
            if (saved && Array.isArray(saved.items)) {
                const seen = new Set();
                items = saved.items.filter(item => item && /^BV[0-9a-zA-Z]{10}$/.test(item.bvid) && !seen.has(item.bvid) && seen.add(item.bvid))
                    .slice(0, 10000).map(item => ({ bvid: item.bvid, name: String(item.name || item.bvid).slice(0, 300),
                        status: item.status === 'done' || item.status === 'failed' ? item.status : 'pending', error: String(item.error || '').slice(0, 300) }));
                mode = ['low', 'medium', 'high'].includes(saved.mode) ? saved.mode : 'medium';
                state = items.some(item => item.status === 'pending') ? 'paused' : items.length ? 'complete' : 'idle';
                message = state === 'paused' ? '上次任务已保留，点击继续缓存。' : '';
            }
        } catch (_) {}
        function pause(reason) {
            generation++;
            state = 'paused'; message = reason || '已暂停，可随时继续。';
            if (controller) controller.abort();
            items.forEach(item => { if (item.status === 'loading') item.status = 'pending'; });
            emit();
        }
        async function pump() {
            if (running || state !== 'running') return;
            if (options.canDownload && !options.canDownload()) {
                if (message !== '等待当前歌曲缓冲，随后继续缓存。') { message = '等待当前歌曲缓冲，随后继续缓存。'; emit(); }
                return;
            }
            const item = items.find(item => item.status === 'pending');
            if (!item) { state = 'complete'; message = ''; emit(); return; }
            running = true;
            const version = generation;
            controller = new AbortController();
            const signal = controller.signal;
            let timer;
            item.status = 'loading'; item.error = ''; message = '正在缓存《' + item.name + '》'; emit();
            timer = setTimeout(() => controller && controller.abort(), 45000);
            try {
                if (!await options.has(item.bvid)) {
                    if (version !== generation) return;
                    if (signal.aborted) throw new Error('下载超时，请重试。');
                    const url = await options.resolve(item.bvid, mode, signal);
                    if (version !== generation) return;
                    if (signal.aborted) throw new Error('下载超时，请重试。');
                    const response = await (options.fetch || fetch)(url, { signal });
                    if (!response.ok) { const error = new Error('音频下载失败，请重试。'); error.status = response.status; throw error; }
                    const blob = await response.blob();
                    if (version !== generation) return;
                    if (signal.aborted) throw new Error('下载超时，请重试。');
                    if (!blob.size) throw new Error('音频为空，请重试。');
                    if (!await options.save(item.bvid, blob)) { const error = new Error('保存失败，请检查浏览器存储空间。'); error.code = 'CACHE_STORE_FAILED'; throw error; }
                }
                if (version !== generation) return;
                item.status = 'done';
                consecutiveFailures = 0;
                if (options.onSaved) options.onSaved(item.bvid);
            } catch (error) {
                if (version !== generation) return;
                item.status = 'failed';
                consecutiveFailures++;
                item.error = signal.aborted ? '下载超时，请重试。' : error.message || '缓存失败，请重试。';
                if (error.code === 'CACHE_STORE_FAILED' || error.code === 'BILI_RISK_CONTROL' || error.status === 429) {
                    state = 'paused'; message = item.error;
                } else if (consecutiveFailures >= 3) {
                    state = 'paused'; message = '连续多首缓存失败，已暂停，请检查网络后重试。';
                }
            } finally {
                clearTimeout(timer); controller = null; running = false;
                if (version === generation) emit();
                // 暂停期间点击继续时，旧请求结束后再启动，始终保持串行。
                if (state === 'running') pump();
            }
        }
        return {
            snapshot,
            isActive() { return state === 'running'; },
            start(songs, quality) {
                if (running || state === 'running' || state === 'paused' && items.some(item => item.status === 'pending')) return false;
                const seen = new Set();
                items = songs.filter(song => /^BV[0-9a-zA-Z]{10}$/.test(song.bvid) && !seen.has(song.bvid) && seen.add(song.bvid))
                    .map(song => ({ bvid: song.bvid, name: song.name || song.bvid, status: 'pending', error: '' }));
                mode = quality; state = 'running'; consecutiveFailures = 0; generation++; emit(); pump(); return true;
            },
            pause,
            resume() { if (!items.some(item => item.status === 'pending')) return; state = 'running'; consecutiveFailures = 0; message = ''; emit(); pump(); },
            retry() { if (state === 'running') return; items.forEach(item => { if (item.status === 'failed') { item.status = 'pending'; item.error = ''; } }); this.resume(); },
            cancel() { generation++; if (controller) controller.abort(); items = []; state = 'idle'; message = ''; emit(); },
            notify() {
                if (state !== 'running') return;
                if (running && options.canDownload && !options.canDownload()) pause('优先保证播放，缓存已暂停，稍后可继续。');
                else pump();
            },
        };
    }
    root.SG_FAVORITES_CACHE = { create };
})(typeof window === 'undefined' ? globalThis : window);
