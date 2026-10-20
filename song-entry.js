/* 分享链接、分 P 与章节选择。异步结果不能覆盖后续输入或用户歌名。 */
(function (root) {
    'use strict';
    function create(options) {
        const input = options.input, name = options.name, status = options.status, retry = options.retry;
        const pageSelect = options.page, chapterSelect = options.chapter, batchSelect = options.batch;
        const startInput = options.start, endInput = options.end, sourcePanel = options.sourcePanel;
        const api = root.SG_BILI_API;
        let version = 0, session = 0, active = false, timer = null, controller = null, pending = null;
        let autoName = '', verified = '', manualName = false, pageWasChanged = false, metadata = null, chapters = [], chapterController = null, chapterVersion = 0;
        function message(text, failed) { status.textContent = text; retry.hidden = !failed; }
        function cancelChapters() { chapterVersion++; if (chapterController) chapterController.abort(); chapterController = null; }
        function cancel() {
            version++; clearTimeout(timer); timer = null;
            if (controller) controller.abort(); controller = null; pending = null; cancelChapters();
        }
        function setOptions(select, items) {
            if (!select) return;
            select.replaceChildren(...items.map(item => {
                const option = document.createElement('option'); option.value = item.value; option.textContent = item.text; return option;
            }));
        }
        function resetSource() {
            metadata = null; chapters = []; pageWasChanged = false; if (sourcePanel) { sourcePanel.hidden = true; sourcePanel.open = false; }
            name.disabled = false; if (options.lyricsPanel) options.lyricsPanel.hidden = false;
            if (startInput) startInput.value = ''; if (endInput) endInput.value = '';
            if (batchSelect) batchSelect.value = 'single';
        }
        function begin() {
            cancel(); resetSource(); session++; active = true; autoName = ''; verified = ''; manualName = !!name.value.trim();
            message('支持 BV 号、视频链接和 b23.tv 分享短链；可选择分 P 或片段。', false);
        }
        function close() { active = false; session++; cancel(); }
        function parsed() { return api.videoInput(input.value); }
        function fillName(value) {
            if (!manualName || !name.value.trim()) { name.value = value; autoName = value; manualName = false; }
        }
        function selectedPage() { return Number(pageSelect && pageSelect.value || (metadata && api.source(metadata.bvid).page) || 1); }
        function pageName(page) {
            const item = metadata && metadata.pages && metadata.pages.find(item => Number(item.page) === page);
            return pageWasChanged && page > 1 && item && item.name ? item.name : metadata.name;
        }
        function batchOptions() {
            if (!batchSelect) return;
            const previous = batchSelect.value;
            const items = [{ value: 'single', text: '仅添加当前选择' }];
            if (metadata && metadata.pages && metadata.pages.length > 1) items.push({ value: 'pages', text: '全部分 P，分别添加（' + metadata.pages.length + ' 首）' });
            if (chapters.length > 1) items.push({ value: 'chapters', text: '当前 P 的全部章节（' + chapters.length + ' 首）' });
            setOptions(batchSelect, items); batchSelect.value = items.some(item => item.value === previous) ? previous : 'single';
        }
        async function loadChapters() {
            cancelChapters(); chapters = [];
            if (!chapterSelect || !metadata) return;
            setOptions(chapterSelect, [{ value: '', text: '正在读取章节…' }]); chapterSelect.disabled = true; batchOptions();
            const ticket = chapterVersion, page = selectedPage(), requestVersion = version;
            const requestController = new AbortController(); chapterController = requestController;
            const timeout = setTimeout(() => requestController.abort(), 8000);
            try {
                const data = await (options.chapters || options.client).chapters(api.trackId(metadata.bvid, page, 0, 0), { signal: requestController.signal });
                if (!active || ticket !== chapterVersion || requestVersion !== version) return;
                chapters = data.chapters.filter(item => item && Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.end > item.start);
                setOptions(chapterSelect, [{ value: '', text: chapters.length ? '保留整段与章节目录' : '没有公开章节，可在下方手动设定片段' }, ...chapters.map((item, i) => ({ value: String(i), text: stamp(item.start) + ' · ' + item.name }))]);
                chapterSelect.disabled = !chapters.length; batchOptions();
            } catch (_) {
                if (active && ticket === chapterVersion && requestVersion === version) setOptions(chapterSelect, [{ value: '', text: '章节暂不可读，可在下方手动设定片段' }]);
            } finally { clearTimeout(timeout); if (ticket === chapterVersion) chapterController = null; }
        }
        function stamp(value) { return Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0'); }
        function showSource(song) {
            metadata = song;
            if (!pageSelect) return;
            const item = api.source(song.bvid), pages = song.pages && song.pages.length ? song.pages : [{ page: item.page, name: song.name }];
            setOptions(pageSelect, pages.map(part => ({ value: String(part.page), text: 'P' + part.page + ' · ' + part.name })));
            pageSelect.value = String(item.page); pageSelect.disabled = pages.length < 2;
            sourcePanel.hidden = false; sourcePanel.open = pages.length > 1 || !!(item.start || item.end);
            startInput.value = item.start ? String(item.start) : ''; endInput.value = item.end ? String(item.end) : '';
            batchOptions(); loadChapters();
        }
        function lookup() {
            clearTimeout(timer); timer = null;
            if (!active) return Promise.resolve(null);
            if (pending) return pending;
            const value = parsed(), key = value.bvid || value.shortUrl;
            if (!key) { message('请输入 BV 号，或粘贴 B 站视频分享链接。', false); return Promise.resolve(null); }
            if (verified === value.bvid && verified) return Promise.resolve(metadata || { bvid: verified });
            const requestVersion = version, requestController = new AbortController(); controller = requestController;
            const timeout = setTimeout(() => requestController.abort(), 12000);
            const known = value.bvid && options.find(value.bvid);
            message(value.shortUrl ? '正在展开 b23.tv 短链并读取视频…' : '正在读取视频与分 P…', false);
            const task = Promise.resolve().then(() => (!pageSelect && known) || options.client.videoInfo(key, { signal: requestController.signal })).then(song => {
                if (!active || version !== requestVersion) return null;
                input.value = api.inputValue(song.bvid); verified = song.bvid;
                fillName(song.name); showSource(song);
                if (song.titleAvailable === false) message('未能读取视频原标题，请重试或手动填写歌名；分 P 与章节仍可选择。', true);
                else message(song.pages && song.pages.length > 1 ? '已读取 ' + song.pages.length + ' 个分 P，选择需要的内容再添加。' : '已填入标题，视频章节会保留在播放页，可自行修改歌名。', false);
                return song;
            }).catch(error => {
                if (active && version === requestVersion) {
                    if (known && !name.value.trim()) fillName(known.name);
                    message(error.name === 'AbortError' ? '读取超时，可重试；也可填写 BV 号和歌名后添加。' : error.message || '暂未读到标题，可以重试或手动填写。', true);
                }
                return null;
            }).finally(() => { clearTimeout(timeout); if (version === requestVersion) { pending = null; controller = null; } });
            pending = task; return task;
        }
        input.addEventListener('input', () => {
            cancel(); verified = ''; resetSource();
            if (!manualName && name.value === autoName) name.value = '';
            autoName = ''; const value = parsed();
            message(value.bvid || value.shortUrl ? '即将读取视频…' : '粘贴 BV 号、视频链接或 b23.tv 短链。', false);
            if (value.bvid || value.shortUrl) timer = setTimeout(lookup, 350);
        });
        name.addEventListener('input', () => { manualName = true; });
        retry.addEventListener('click', () => { cancel(); verified = ''; lookup(); });
        if (batchSelect) batchSelect.addEventListener('change', () => {
            const batch = batchSelect.value !== 'single'; name.disabled = batch;
            if (options.lyricsPanel) options.lyricsPanel.hidden = batch;
            message(batch ? '将按每项的原标题分别添加，重复条目会自动合并。' : '可修改当前项的歌名和播放范围。', false);
        });
        if (pageSelect) pageSelect.addEventListener('change', () => {
            pageWasChanged = true;
            startInput.value = endInput.value = ''; fillName(pageName(selectedPage())); loadChapters();
        });
        if (chapterSelect) chapterSelect.addEventListener('change', () => {
            const chapter = chapters[Number(chapterSelect.value)];
            if (chapterSelect.value !== '' && chapter) {
                startInput.value = String(chapter.start); endInput.value = String(chapter.end); fillName(chapter.name);
            } else { startInput.value = endInput.value = ''; fillName(pageName(selectedPage())); }
        });
        async function read() {
            const before = version, currentSession = session;
            if (!(manualName && name.value.trim() && !retry.hidden && parsed().bvid)) await lookup();
            if (!active || before !== version || currentSession !== session) return null;
            let bvid = parsed().bvid; const title = name.value.trim();
            if (!bvid) throw new Error('未找到 BV 号，请检查视频分享链接或直接填写 BV 号。');
            if (!title && !(metadata && batchSelect && batchSelect.value !== 'single')) throw new Error('暂未获取到标题，请重试或手动填写歌名。');
            let songs;
            if (metadata && pageSelect) {
                const mode = batchSelect.value, page = selectedPage();
                if (mode === 'pages') songs = metadata.pages.map(item => ({ bvid: api.trackId(bvid, item.page, 0, 0), name: item.name }));
                else if (mode === 'chapters') songs = chapters.map(item => ({ bvid: api.trackId(bvid, page, item.start, item.end), name: item.name }));
                else {
                    const start = api.time(startInput.value), end = api.time(endInput.value), item = metadata.pages && metadata.pages.find(item => Number(item.page) === page);
                    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end && end <= start || item && item.duration && (start >= item.duration || end > item.duration + 1)) throw new Error('请检查片段起止时间，结束时间需大于开始时间且不超过该 P 时长。');
                    bvid = api.trackId(bvid, page, start, end);
                    if (!bvid) throw new Error('片段范围无效，请重新填写。');
                }
            }
            if (songs && (!songs.length || songs.length > 2000 || songs.some(item => !item.bvid))) throw new Error('没有可添加的条目，或数量超过 2000 首。');
            return { bvid, name: title.slice(0, 300), verified: !!verified, ...(songs ? { songs } : {}) };
        }
        return { begin, close, read, get session() { return session; }, current: value => active && value === session };
    }
    root.SG_SONG_ENTRY = { create };
})(window);
