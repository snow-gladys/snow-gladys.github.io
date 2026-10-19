/* 直播只在点击时取流，复用原生 HLS；MSE 组件延后加载。歌曲播放器通过 host 对接。 */
(function (root) {
    'use strict';
    let hlsScript;
    function loadHls() {
        if (root.Hls) return Promise.resolve(root.Hls);
        if (!hlsScript) hlsScript = new Promise((resolve, reject) => {
            const script = document.createElement('script'); script.src = 'vendor/hls.light-1.6.13.min.js';
            script.onload = () => resolve(root.Hls);
            script.onerror = () => { script.remove(); hlsScript = null; reject(new Error('播放组件未能加载，请重试。')); };
            document.head.appendChild(script);
        });
        return hlsScript;
    }
    root.SG_LIVE = { create(host) {
        const dialog = document.getElementById('live-dialog'), trigger = document.getElementById('btn-live');
        const grid = document.getElementById('live-members'), status = document.getElementById('live-status');
        const card = document.getElementById('live-now-playing'), title = document.getElementById('live-now-title');
        const detail = document.getElementById('live-now-status'), toggleButton = document.getElementById('live-toggle');
        const profiles = root.SG_WARDROBE.profiles;
        const rooms = { gladys: '30858592', fiona: '30849777', diana: '22637261', eileen: '22625027', bella: '22632424' };
        let records = new Map(), checked = 0, pendingStatus = null, state = null, version = 0;
        let audio = null, hls = null, controller = null, watchdog = null, statusTimer = null;
        const rows = new Map();
        function sync() {
            const live = profiles.filter(item => records.get(item.id)?.live), count = live.length;
            trigger.classList.toggle('has-live', count > 0);
            const current = state && profiles.find(item => item.id === state.member);
            const mode = state ? state.error ? 'error' : state.loading ? 'connecting' : audio && !audio.paused ? 'listening' : 'paused' : count ? 'live' : 'idle';
            trigger.dataset.state = mode;
            trigger.querySelector('span').textContent = current ? state.error ? '连接中断 · 重试' : state.loading ? '正在连接…' : audio && !audio.paused ? '正在听 · ' + current.short : '已暂停 · ' + current.short : count === 1 ? live[0].short + ' 正在直播' : count > 1 ? count + ' 位正在直播' : '直播电台';
            trigger.setAttribute('aria-label', trigger.querySelector('span').textContent + '，打开直播电台');
            card.hidden = !state;
            document.getElementById('view-home').classList.toggle('has-live-player', !!state);
            if (state) {
                const profile = profiles.find(item => item.id === state.member);
                title.textContent = profile.name;
                detail.textContent = state.error || (state.loading ? '正在连接直播…' : audio && !audio.paused ? '正在收听 · 直播' : '已暂停 · 点击回到直播');
                toggleButton.textContent = state.loading ? '取消' : state.error ? '重试' : audio && !audio.paused ? '暂停' : '收听';
                document.getElementById('live-room-link').href = 'https://live.bilibili.com/' + rooms[state.member];
                card.querySelector('img').src = root.SG_WARDROBE.image(state.member);
                card.querySelector('img').style.objectPosition = root.SG_WARDROBE.image(state.member) === profile.image ? profile.position : '50% 50%';
            }
            for (const profile of profiles) {
                const row = rows.get(profile.id), info = records.get(profile.id);
                row.image.src = root.SG_WARDROBE.image(profile.id);
                row.image.style.objectPosition = root.SG_WARDROBE.image(profile.id) === profile.image ? profile.position : '50% 50%';
                row.status.textContent = info && info.known ? info.live ? info.title || '正在直播' : '未开播' : '状态待确认';
                row.element.classList.toggle('is-live', !!(info && info.live));
                const same = state && state.member === profile.id, playing = audio && !audio.paused;
                row.listen.textContent = same ? state.loading ? '连接中' : state.error ? '重试' : playing ? '收听中' : '继续' : info && info.known && !info.live ? '试着收听' : '收听';
                row.listen.disabled = !!(same && (state.loading || playing));
            }
            host.changed();
        }
        async function json(path, signal) {
            let response, data;
            try { response = await fetch(host.base + path, { signal }); data = await response.json(); }
            catch (error) { if (error.name === 'AbortError') throw error; throw new Error('暂时无法连接直播服务，请检查网络后重试。'); }
            if (!response.ok || !data || data.error) {
                const error = new Error(data && data.error || '直播服务暂时不可用。'); error.code = data && data.code;
                if (response.status === 404 && error.code === 'NOT_FOUND') error.message = '直播功能尚未就绪，请更新边缘函数后重试。';
                throw error;
            }
            return data;
        }
        async function checkPlaylist(url, signal) {
            const response = await fetch(url, { signal });
            const text = await response.text();
            if (!response.ok || !text.startsWith('#EXTM3U')) {
                let data; try { data = JSON.parse(text); } catch (_) {}
                throw new Error(data && data.error || '直播音频线路暂时无法连接，请重试或前往 B 站收听。');
            }
        }
        async function refresh(force) {
            if (pendingStatus) return pendingStatus;
            if (!force && Date.now() - checked < 60000) return;
            const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 10000);
            pendingStatus = (async () => {
                try {
                    const data = await json('/live/status', abort.signal);
                    if (!Array.isArray(data.members)) throw new Error('直播状态暂时无法确认，可直接选择成员尝试收听。');
                    records = new Map(data.members.filter(item => rooms[item.id]).map(item => [item.id, item])); checked = Date.now();
                    status.textContent = '仅收听声音。切换直播会暂停当前歌曲，歌曲进度会保留。';
                    status.classList.remove('is-error');
                } catch (error) {
                    records.clear(); checked = Date.now();
                    status.textContent = error.name === 'AbortError' ? '查询超时，可直接选择成员尝试收听。' : error.message;
                    status.classList.add('is-error');
                } finally { clearTimeout(timeout); pendingStatus = null; sync(); }
            })();
            return pendingStatus;
        }
        function release() {
            clearTimeout(watchdog); watchdog = null;
            if (controller) controller.abort(); controller = null;
            if (hls) hls.destroy(); hls = null;
            if (audio) { const old = audio; audio = null; old.pause(); old.removeAttribute('src'); old.load(); old.remove(); }
        }
        function stop() {
            version++; release(); state = null;
            status.textContent = '仅收听声音。切换直播会暂停当前歌曲，歌曲进度会保留。'; status.classList.remove('is-error');
            sync(); host.media();
        }
        function fail(error, ticket) {
            if (ticket !== version || !state) return;
            version++; release(); const message = error.message || '直播中断，请重试或前往 B 站收听。';
            if (error.code === 'LIVE_OFFLINE') records.set(state.member, { id: state.member, known: true, live: false });
            if (state.engaged) { state.loading = false; state.error = message; } else state = null;
            status.textContent = message; status.classList.add('is-error'); sync(); host.toast(message, 4500); host.media();
        }
        async function listen(member) {
            const ticket = ++version, engaged = !!(state && state.engaged); release();
            state = { member, loading: true, error: '', engaged }; sync();
            status.textContent = '正在连接' + profiles.find(item => item.id === member).name + '的直播…'; status.classList.remove('is-error');
            controller = new AbortController();
            watchdog = setTimeout(() => fail(new Error('连接直播超时，请重试或前往 B 站收听。'), ticket), 15000);
            let suspended = false;
            try {
                const result = await json('/live/stream?member=' + member, controller.signal);
                if (ticket !== version) return;
                const url = new URL(result.url);
                if (url.origin !== new URL(host.base).origin || url.pathname !== '/live/playlist.m3u8') throw new Error('直播音频地址异常，请重试。');
                await checkPlaylist(url.href, controller.signal);
                if (ticket !== version) return;
                const next = new Audio(); next.playsInline = true; next.crossOrigin = 'anonymous'; next.preload = 'none';
                const native = !!next.canPlayType('application/vnd.apple.mpegurl');
                const Hls = native ? null : await loadHls();
                if (ticket !== version) return;
                if (!native && (!Hls || !Hls.isSupported())) throw new Error('当前浏览器暂不支持直播音频，请前往 B 站收听。');
                const reason = host.suspend(); if (reason !== true) throw new Error(reason || '暂时无法切换直播，请稍后重试。');
                suspended = true; state.engaged = true; audio = next; audio.volume = host.volume(); document.body.appendChild(audio);
                function on(type, callback) { next.addEventListener(type, () => { if (ticket === version && audio === next) callback(); }); }
                on('playing', () => {
                    clearTimeout(watchdog); state.loading = false; state.error = '';
                    status.textContent = '仅收听声音。切换直播会暂停当前歌曲，歌曲进度会保留。'; status.classList.remove('is-error');
                    sync(); host.media();
                });
                on('pause', () => { sync(); host.media(); });
                on('ended', () => fail(new Error('直播已结束或连接中断，可以重试。'), ticket));
                on('error', () => fail(new Error('直播音频暂时无法播放，请重试或前往 B 站收听。'), ticket));
                on('waiting', () => { clearTimeout(watchdog); watchdog = setTimeout(() => fail(new Error('直播连接中断，请重试。'), ticket), 15000); });
                if (native) { audio.src = url.href; audio.load(); }
                else {
                    hls = new Hls({ maxBufferLength: 12, backBufferLength: 0, liveSyncDurationCount: 2, enableWorker: true });
                    hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) fail(new Error('直播连接中断，请重试。'), ticket); });
                    hls.loadSource(url.href); hls.attachMedia(audio);
                }
                await audio.play();
                if (ticket === version && dialog.open) dialog.close();
            } catch (error) {
                if (ticket !== version) return;
                if (error.name === 'AbortError') return;
                fail(error, ticket);
                // 播放已失败，不自动恢复声音；保留明确的“返回歌曲”入口。
                if (suspended) host.media();
            }
        }
        function pause() {
            if (!state) return;
            if (!state.engaged) { stop(); return; }
            version++; release(); state.loading = false; sync(); host.media();
        }
        function toggle() { if (!state) return; if (state.loading) { stop(); return; } if (audio && !audio.paused) pause(); else listen(state.member); }
        function open() { if (!dialog.open) dialog.showModal(); refresh(false); }
        for (const profile of profiles) {
            const row = document.createElement('div'); row.className = 'live-member';
            const image = document.createElement('img'); image.alt = ''; image.width = image.height = 44;
            const copy = document.createElement('div'); copy.className = 'live-member-copy';
            const name = document.createElement('strong'); name.textContent = profile.name;
            const caption = document.createElement('span'); copy.append(name, caption);
            const listenButton = document.createElement('button'); listenButton.type = 'button'; listenButton.textContent = '收听'; listenButton.setAttribute('aria-label', '收听' + profile.name + '的直播');
            listenButton.addEventListener('click', () => listen(profile.id));
            const link = document.createElement('a'); link.href = 'https://live.bilibili.com/' + rooms[profile.id]; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '↗'; link.setAttribute('aria-label', '前往' + profile.name + '的 B 站直播间');
            row.append(image, copy, listenButton, link); grid.appendChild(row);
            rows.set(profile.id, { element: row, image, status: caption, listen: listenButton });
        }
        trigger.addEventListener('click', open);
        document.getElementById('live-close').addEventListener('click', () => dialog.close());
        document.getElementById('live-refresh').addEventListener('click', () => refresh(true));
        toggleButton.addEventListener('click', toggle);
        document.getElementById('live-stop').addEventListener('click', stop);
        document.getElementById('live-back-music').addEventListener('click', () => { stop(); host.resume(); });
        dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
        root.addEventListener('sg:appearance', sync);
        document.addEventListener('visibilitychange', () => { clearTimeout(statusTimer); if (!document.hidden) { refresh(false); schedule(); } });
        function schedule() { clearTimeout(statusTimer); statusTimer = setTimeout(() => { if (!document.hidden) { refresh(false); schedule(); } }, 90000); }
        // 音频预加载先行；状态查询不占用开屏第一帧。
        setTimeout(() => { if (!document.hidden) refresh(false); schedule(); }, 1200);
        sync();
        return { active: () => !!state, playing: () => !!(state && audio && !audio.paused && !state.loading && !state.error),
            ownsMedia: () => !!(state && state.engaged),
            audio: () => audio, state: () => state, stop, pause, toggle, open,
            metadata() {
                if (!state || !navigator.mediaSession) return;
                if (!host.mediaEnabled()) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; return; }
                const profile = profiles.find(item => item.id === state.member), record = records.get(state.member);
                navigator.mediaSession.metadata = new MediaMetadata({ title: record && record.title || profile.name + '的直播', artist: profile.name + ' · 直播',
                    artwork: root.SG_WARDROBE.artwork() });
                navigator.mediaSession.playbackState = audio && !audio.paused ? 'playing' : 'paused';
                for (const action of ['previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward']) { try { navigator.mediaSession.setActionHandler(action, null); } catch (_) {} }
                navigator.mediaSession.setActionHandler('play', () => { if (!audio || audio.paused) listen(state.member); });
                navigator.mediaSession.setActionHandler('pause', pause);
                navigator.mediaSession.setActionHandler('stop', stop);
                try { navigator.mediaSession.setPositionState(); } catch (_) {}
            } };
    } };
})(window);
