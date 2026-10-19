/* 粘贴分享内容后自动填标题；取消、快速修改和手动歌名优先于异步结果。 */
(function (root) {
    'use strict';
    function create(options) {
        const input = options.input, name = options.name, status = options.status, retry = options.retry;
        let version = 0, session = 0, active = false, timer = null, controller = null, pending = null;
        let autoName = '', verified = '', manualName = false;
        function message(text, failed) {
            status.textContent = text; retry.hidden = !failed;
        }
        function cancel() {
            version++; clearTimeout(timer); timer = null;
            if (controller) controller.abort(); controller = null; pending = null;
        }
        function begin() {
            cancel(); session++; active = true; autoName = ''; verified = ''; manualName = !!name.value.trim();
            message('粘贴后自动读取视频标题，也可以手动填写歌名。', false);
        }
        function close() { active = false; session++; cancel(); }
        function parsed() { return root.SG_BILI_API.videoInput(input.value); }
        function lookup() {
            clearTimeout(timer); timer = null;
            if (!active) return Promise.resolve(null);
            if (pending) return pending;
            const value = parsed(), key = value.bvid || value.shortUrl;
            if (!key) { message('请输入 BV 号，或粘贴 B 站视频分享链接。', false); return Promise.resolve(null); }
            if (value.bvid) input.value = value.bvid;
            if (verified === value.bvid && verified) return Promise.resolve({ bvid: verified });
            const requestVersion = version;
            const requestController = new AbortController(); controller = requestController;
            const timeout = setTimeout(() => requestController.abort(), 10000);
            const known = value.bvid && options.find(value.bvid);
            message('正在读取视频标题…', false);
            const task = Promise.resolve().then(() => known || options.client.videoInfo(key, { signal: requestController.signal })).then(song => {
                if (!active || version !== requestVersion) return null;
                input.value = song.bvid; verified = song.bvid;
                if (!manualName || !name.value.trim()) { name.value = song.name; autoName = song.name; manualName = false; }
                message(known ? '已从歌曲库填入歌名，可自行修改。' : '已填入视频标题，可自行修改歌名。', false);
                return song;
            }).catch(error => {
                if (active && version === requestVersion) message(error.name === 'AbortError'
                    ? '读取超时，可以重试，或填写 BV 号和歌名后添加。'
                    : '暂未读到标题，可以重试，或填写 BV 号和歌名后添加。', true);
                return null;
            }).finally(() => {
                clearTimeout(timeout);
                if (version === requestVersion) { pending = null; controller = null; }
            });
            pending = task; return task;
        }
        input.addEventListener('input', () => {
            cancel(); verified = '';
            if (!manualName && name.value === autoName) name.value = '';
            autoName = '';
            const value = parsed();
            if (value.bvid) input.value = value.bvid;
            message(value.bvid || value.shortUrl ? '即将读取视频标题…' : '粘贴 BV 号或 B 站视频分享链接。', false);
            if (value.bvid || value.shortUrl) timer = setTimeout(lookup, 350);
        });
        name.addEventListener('input', () => { manualName = true; });
        retry.addEventListener('click', () => { cancel(); lookup(); });
        async function read() {
            const before = version, currentSession = session;
            if (!(manualName && name.value.trim() && !retry.hidden && root.SG_BILI_API.normalizeId(input.value))) await lookup();
            if (!active || before !== version || currentSession !== session) return null;
            const bvid = root.SG_BILI_API.normalizeId(input.value), title = name.value.trim();
            if (!bvid) throw new Error('未找到 BV 号，请检查视频分享链接或直接填写 BV 号。');
            if (!title) throw new Error('暂未获取到标题，请重试或手动填写歌名。');
            return { bvid, name: title.slice(0, 300), verified: verified === bvid };
        }
        return { begin, close, read, get session() { return session; }, current: value => active && value === session };
    }
    root.SG_SONG_ENTRY = { create };
})(window);
