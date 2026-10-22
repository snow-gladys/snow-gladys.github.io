/* 公开章节按 BV + P 缓存在本机；播放时展示目录，点击只跳转、不切歌。 */
(function (root) {
    'use strict';
    const STORAGE_KEY = 'sg_video_chapters_v1', MAX_ENTRIES = 64, MAX_CHARS = 256 * 1024;
    const TTL = 24 * 60 * 60 * 1000, EMPTY_TTL = 10 * 60 * 1000;
    function clean(values) {
        const seen = new Set();
        return (Array.isArray(values) ? values : []).flatMap(item => {
            if (!item || typeof item.name !== 'string' || !item.name.trim() || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start || item.end > 604800) return [];
            const key = item.start + ':' + item.end;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{ name: item.name.trim().slice(0, 200), start: item.start, end: item.end }];
        }).sort((a, b) => a.start - b.start).slice(0, 1000);
    }
    function sourceKey(id) {
        const source = root.SG_BILI_API.source(id);
        return source ? root.SG_BILI_API.trackId(source.bvid, source.page, 0, 0) : '';
    }
    function createStore(options) {
        const entries = new Map(), pending = new Map();
        try {
            const raw = options.storage && options.storage.getItem(STORAGE_KEY);
            const rows = raw && raw.length <= MAX_CHARS ? JSON.parse(raw) : null;
            if (Array.isArray(rows)) for (const row of rows.slice(-MAX_ENTRIES)) {
                const key = row && sourceKey(row.key);
                if (!key || !Number.isFinite(row.savedAt) || row.savedAt < 0) continue;
                const chapters = clean(row.chapters);
                if (chapters.length) entries.set(key, { key, chapters, savedAt: row.savedAt });
            }
        } catch (_) { /* 存储不可用时仍可在线读取。 */ }
        function persist() {
            if (!options.storage) return;
            let rows = [...entries.values()].filter(row => row.chapters.length).slice(-MAX_ENTRIES), text = JSON.stringify(rows);
            while (rows.length && text.length > MAX_CHARS) { entries.delete(rows.shift().key); text = JSON.stringify(rows); }
            try { options.storage.setItem(STORAGE_KEY, text); } catch (_) {}
        }
        function remember(key, chapters) {
            entries.delete(key);
            const row = { key, chapters: clean(chapters), savedAt: Date.now() };
            entries.set(key, row);
            while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
            persist(); return row;
        }
        function peek(id) {
            const row = entries.get(sourceKey(id));
            return row ? { chapters: row.chapters.map(item => ({ ...item })), savedAt: row.savedAt } : null;
        }
        async function chapters(id, requestOptions) {
            requestOptions = requestOptions || {};
            if (requestOptions.signal && requestOptions.signal.aborted) throw new DOMException('已取消读取', 'AbortError');
            const key = sourceKey(id);
            if (!key) throw new Error('无法识别当前视频。');
            const cached = entries.get(key);
            if (root.navigator && root.navigator.onLine === false) {
                if (cached) return { chapters: cached.chapters.map(item => ({ ...item })), warning: '离线目录，联网后可刷新。' };
                throw new Error('当前离线，尚未保存这个视频的章节。');
            }
            if (!requestOptions.force && cached && Date.now() - cached.savedAt < (cached.chapters.length ? TTL : EMPTY_TTL)) return { chapters: cached.chapters.map(item => ({ ...item })) };
            if (!requestOptions.signal && pending.has(key)) return pending.get(key);
            const task = (async () => {
                try {
                    const result = await options.client.chapters(key, requestOptions);
                    if (requestOptions.signal && requestOptions.signal.aborted) throw new DOMException('已取消读取', 'AbortError');
                    const row = remember(key, result.chapters);
                    return { chapters: row.chapters.map(item => ({ ...item })) };
                } catch (error) {
                    if (error.name === 'AbortError') throw error;
                    if (cached && cached.chapters.length) return { chapters: cached.chapters.map(item => ({ ...item })), warning: '暂时无法更新章节，仍可使用已保存的目录。' };
                    throw error;
                }
            })();
            if (!requestOptions.signal) pending.set(key, task);
            try { return await task; } finally { if (pending.get(key) === task) pending.delete(key); }
        }
        return { peek, chapters };
    }
    function visibleChapters(values, source) {
        if (!source) return [];
        return clean(values).filter(item => item.end > source.start && (!source.end || item.start < source.end))
            .map(item => ({ ...item, time: Math.max(0, item.start - source.start), until: (source.end ? Math.min(item.end, source.end) : item.end) - source.start }));
    }
    function activeIndex(items, time) {
        // 有些视频的章节之间存在空白，不把空白误标成上一章节。
        for (let i = items.length - 1; i >= 0; i--) if (time >= items[i].time && time < items[i].until) return i;
        return -1;
    }
    function createNavigator(options) {
        const { button, label, dialog, list, status, retry, heading } = options;
        let track = '', key = '', items = [], state = 'idle', warning = '', controller = null, task = null, version = 0, current = -2, seekReady = null;
        function setMessage() {
            status.textContent = state === 'loading' ? '正在读取视频章节…' : state === 'error' ? '暂时无法读取章节，可以重试；歌曲会继续播放。'
                : warning || (items.length ? '点击章节跳转，歌曲保持当前播放或暂停状态。' : '当前播放范围内没有公开章节。');
            retry.textContent = state === 'error' ? '重试读取' : '刷新章节'; retry.disabled = state === 'loading';
        }
        function render() {
            list.replaceChildren();
            for (let index = 0; index < items.length; index++) {
                const item = items[index], row = document.createElement('button');
                row.type = 'button'; row.className = 'playback-chapter-item'; row.dataset.chapterIndex = String(index); row.dataset.chapterTrack = track;
                const time = document.createElement('span'); time.className = 'playback-chapter-time'; time.textContent = options.format(item.time);
                const name = document.createElement('span'); name.className = 'playback-chapter-name'; name.textContent = item.name;
                const mark = document.createElement('span'); mark.className = 'playback-chapter-mark'; mark.textContent = '当前'; mark.setAttribute('aria-hidden', 'true');
                row.append(time, name, mark); list.append(row);
            }
            current = -2; seekReady = null; setMessage(); sync();
        }
        function refresh() {
            const next = options.track() || '';
            if (next === track) return;
            version++; if (controller) controller.abort(); controller = null; task = null;
            track = next; key = sourceKey(next); items = []; state = 'idle'; warning = '';
            button.hidden = !key;
            if (!key) { if (dialog.open) dialog.close(); render(); return; }
            const cached = options.store.peek(key);
            if (cached) { items = visibleChapters(cached.chapters, root.SG_BILI_API.source(track)); state = Date.now() - cached.savedAt < (cached.chapters.length ? TTL : EMPTY_TTL) ? 'ready' : 'cached'; }
            heading.textContent = options.name(); render();
        }
        function sync() {
            refresh();
            if (!key) return;
            const ready = !options.canSeek || options.canSeek();
            if (ready !== seekReady) { seekReady = ready; for (const row of list.children) row.disabled = !ready; }
            const index = activeIndex(items, options.time());
            if (index === current) return;
            current = index;
            const name = items[index] && items[index].name;
            label.textContent = name ? '章节 · ' + name : state === 'loading' && !items.length ? '读取章节…' : '章节' + (items.length ? ' · ' + items.length : '');
            button.setAttribute('aria-label', name ? '视频章节，当前为' + name + '，打开章节目录' : '打开视频章节目录');
            for (let i = 0; i < list.children.length; i++) {
                list.children[i].classList.toggle('is-current', i === index);
                if (i === index) list.children[i].setAttribute('aria-current', 'true'); else list.children[i].removeAttribute('aria-current');
            }
        }
        async function ensure(force) {
            refresh(); if (!key || task) return task;
            if (!force && state === 'ready') return;
            const ticket = version, requestedTrack = track, requestController = new AbortController(); controller = requestController;
            const timer = setTimeout(() => requestController.abort(), 10000);
            state = 'loading'; current = -2; seekReady = null; setMessage(); sync();
            const load = options.store.chapters(key, { force: !!force, signal: requestController.signal }).then(result => {
                if (ticket !== version || requestedTrack !== options.track()) return;
                items = visibleChapters(result.chapters, root.SG_BILI_API.source(track)); state = 'ready'; warning = result.warning || ''; render();
            }).catch(() => {
                if (ticket !== version || requestedTrack !== options.track()) return;
                state = items.length ? 'ready' : 'error'; warning = items.length ? '暂时无法更新章节，仍可使用已保存的目录。' : ''; current = -2; seekReady = null; setMessage(); sync();
            }).finally(() => { clearTimeout(timer); if (ticket === version) { task = null; controller = null; } });
            task = load; return load;
        }
        button.addEventListener('click', () => { refresh(); if (!key) return; dialog.showModal(); ensure(false); sync(); });
        retry.addEventListener('click', () => ensure(true));
        dialog.querySelector('[data-close-chapters]').addEventListener('click', () => dialog.close());
        list.addEventListener('click', event => {
            const row = event.target.closest('[data-chapter-index]');
            if (!row || row.dataset.chapterTrack !== options.track()) return;
            const item = items[Number(row.dataset.chapterIndex)]; if (!item || options.canSeek && !options.canSeek()) return;
            try { options.seek(item.time); }
            catch (_) { status.textContent = '音频还在加载，稍后再试一下。'; return; }
            options.onSeek(); sync(); dialog.close();
        });
        refresh();
        return { refresh, sync, ensure };
    }
    root.SG_PLAYBACK_CHAPTERS = { createStore, createNavigator, clean, sourceKey, visibleChapters, activeIndex };
})(typeof window === 'undefined' ? globalThis : window);
