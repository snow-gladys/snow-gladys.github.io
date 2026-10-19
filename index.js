        // 首页频谱背景（与 index_new 风格一致）
        (function () {
            var visualizer = document.getElementById('visualizer');

            if (!visualizer) return;

            var barCount = 45;
            var fragment = document.createDocumentFragment();

            var peaks = [];
            var numMainPeaks = 1 + Math.floor(Math.random() * 2);
            for (var i = 0; i < numMainPeaks; i++) {
                peaks.push({
                    center: 10 + Math.random() * 25,
                    width: 3 + Math.random() * 3,
                    height: 0.7 + Math.random() * 0.4
                });
            }
            var numSubPeaks = 3 + Math.floor(Math.random() * 2);
            for (var j = 0; j < numSubPeaks; j++) {
                peaks.push({
                    center: Math.random() * 45,
                    width: 3 + Math.random() * 4,
                    height: 0.2 + Math.random() * 0.3
                });
            }

            for (var k = 0; k < barCount; k++) {
                var targetHeight = 0.05;

                peaks.forEach(function (peak) {
                    var distance = k - peak.center;
                    var effect = Math.exp(-(distance * distance) / (2 * peak.width * peak.width));
                    targetHeight += effect * peak.height;
                });

                var globalEnvelope = 0.2 + 0.8 * Math.sin(Math.PI * (k / (barCount - 1)));
                targetHeight = targetHeight * globalEnvelope;

                targetHeight += Math.random() * 0.03;
                targetHeight = Math.min(1, targetHeight);

                var duration = 0.8 + Math.random() * 0.7;

                var bar = document.createElement('div');
                bar.className = 'bar';
                bar.style.setProperty('--h', (targetHeight * 100) + '%');
                bar.style.setProperty('--d', duration + 's');
                bar.style.animationDelay = '-' + (Math.random() * 2) + 's';

                fragment.appendChild(bar);
            }

            visualizer.appendChild(fragment);
        })();

        // --- 0. 播放器配置：歌库共用，外观由装扮选择 ---
        var SG_PLAYER_CONFIG = window.SG_PLAYER_CONFIG || {};
        var initialAppearance = window.SG_WARDROBE.profile(window.SG_WARDROBE.selected);
        var CONFIG = {
            storageKeys: {
                fav: SG_PLAYER_CONFIG.storageKeys && SG_PLAYER_CONFIG.storageKeys.fav !== undefined ? SG_PLAYER_CONFIG.storageKeys.fav : 'sg_fav',
                playMode: SG_PLAYER_CONFIG.storageKeys && SG_PLAYER_CONFIG.storageKeys.playMode !== undefined ? SG_PLAYER_CONFIG.storageKeys.playMode : 'sg_play_mode',
                custom: SG_PLAYER_CONFIG.storageKeys && SG_PLAYER_CONFIG.storageKeys.custom !== undefined ? SG_PLAYER_CONFIG.storageKeys.custom : 'sg_custom_songs'
            },
            settingsCookie: SG_PLAYER_CONFIG.settingsCookie !== undefined ? SG_PLAYER_CONFIG.settingsCookie : 'sg_settings',
            defaultTitle: SG_PLAYER_CONFIG.defaultTitle !== undefined ? SG_PLAYER_CONFIG.defaultTitle : initialAppearance.name,
            titleSuffix: SG_PLAYER_CONFIG.titleSuffix !== undefined ? SG_PLAYER_CONFIG.titleSuffix : initialAppearance.short,
            vmid: SG_PLAYER_CONFIG.vmid !== undefined ? SG_PLAYER_CONFIG.vmid : initialAppearance.vmid,
            apiBase: SG_PLAYER_CONFIG.apiBase !== undefined ? SG_PLAYER_CONFIG.apiBase : 'https://snow-gladys-api-zone-3msnp1a62hlu-1304656834.eo-edgefunctions.com',
            version: SG_PLAYER_CONFIG.version !== undefined ? SG_PLAYER_CONFIG.version : '0.1.0(测)',
            exportFilename: SG_PLAYER_CONFIG.exportFilename !== undefined ? SG_PLAYER_CONFIG.exportFilename : 'custom_songs_sinuo.txt',
            lyricsBasePath: SG_PLAYER_CONFIG.lyricsBasePath
        };

        let DEFAULT_TITLE = CONFIG.defaultTitle;
        const CURRENT_VERSION = CONFIG.version;
        // 确保在任何函数使用前就声明当前播放的 bvid
        let currentPlayingBvid = '';
        let failedPlaybackBvid = '';
        let failedPlaybackKind = '';

        // IndexedDB 可用性检测（由 lyrics-db.js 注入 window.SG_LYRICS）
        (function checkIdbSupport() {
            if (CONFIG.lyricsBasePath && window.SG_LYRICS && typeof window.SG_LYRICS.setBasePath === 'function') {
                window.SG_LYRICS.setBasePath(CONFIG.lyricsBasePath);
            }
            if (window.SG_LYRICS && !window.SG_LYRICS.supported) {
                var el = document.getElementById('toast');
                if (!el) return;
                el.textContent = '当前浏览器不支持 IndexedDB，无法使用自定义歌词功能。';
                el.classList.add('is-visible');
                setTimeout(function () { el.classList.remove('is-visible'); }, 6000);
            }
        })();
        const API_BASE = CONFIG.apiBase;
        const biliClient = window.SG_BILI_API.createClient(API_BASE);

        // --- 1. 获取粉丝数逻辑 ---
        const fanCountElement = document.getElementById('fan-count');
        
        let fanRequestVersion = 0;
        async function fetchFanCount() {
            const requestVersion = ++fanRequestVersion;
            try {
                const response = await fetch(`${API_BASE}/fans?vmid=${CONFIG.vmid}`);
                if (!response.ok) throw new Error();
                
                const data = await response.json();
                if (requestVersion !== fanRequestVersion) return;
                if (data.code === 0) {
                    fanCountElement.innerText = data.data.follower.toLocaleString();
                }
            } catch (error) {
                if (requestVersion !== fanRequestVersion) return;
                console.error("粉丝数获取失败:", error);
                fanCountElement.innerText = '---';
            }
        }
        fetchFanCount(); // 立即运行一次

        // --- 1.5 收藏（Local Storage，容量大、无 cookie 上限）---
        const FAV_STORAGE_KEY = CONFIG.storageKeys.fav;
        const PLAY_MODE_STORAGE_KEY = CONFIG.storageKeys.playMode;
        const PLAY_SCOPE_STORAGE_KEY = PLAY_MODE_STORAGE_KEY + '_scope';
        const PLAY_SESSION_STORAGE_KEY = PLAY_MODE_STORAGE_KEY + '_session';
        const randomQueue = window.SG_PLAYBACK_STATE.createQueue();
        let libraryStorage = null;
        try { libraryStorage = localStorage; } catch (_) {}
        let legacyMigrationError = '';
        try { window.SG_PERSONAL.migrateLegacy(libraryStorage); }
        catch (error) { legacyMigrationError = error.message || '旧版数据合并暂未完成，原数据已保留。'; }
        const personalLibrary = window.SG_PERSONAL.create({ storage: libraryStorage,
            onChange: function () { if (typeof syncCollections === 'function') syncCollections(); },
        });
        let playbackPlaylistId = '';
        try { playbackPlaylistId = localStorage.getItem('sg_playback_playlist') || ''; } catch (_) {}
        let browsedPlaylistId = '';

        const listeningLibrary = window.SG_LISTENING.create({ storage: libraryStorage, key: PLAY_MODE_STORAGE_KEY + '_library',
            onError: function () { showToast('浏览器存储不可用，本次修改暂时只在当前页面保留。'); },
            onChange: function () {
                playlistRenderKey = '';
                syncLibraryTabs();
                if (viewPlaylist.classList.contains('is-open')) renderPlaylist();
            },
        });
        let bulkCache = null;
        let resumeSession = null;
        try { resumeSession = window.SG_PLAYBACK_STATE.readSession(localStorage, PLAY_SESSION_STORAGE_KEY); } catch (_) {}
        let sessionAudioBvid = '';
        let pendingPlayback = null;
        let lastSessionWrite = 0;
        let favoritesSet = new Set();

        function getFavoritesFromStorage() {
            try {
                const raw = localStorage.getItem(FAV_STORAGE_KEY);
                if (!raw) return new Set();
                const arr = JSON.parse(raw);
                if (!Array.isArray(arr)) return new Set();
                return new Set(arr.filter(Boolean).map(s => String(s).toUpperCase()));
            } catch (e) { return new Set(); }
        }

        function saveFavoritesToStorage() {
            try {
                const arr = Array.from(favoritesSet);
                localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(arr));
                return true;
            } catch (e) { return false; }
        }

        function toggleFavorite(bvid) {
            if (!bvid) return;
            const key = (bvid || '').toUpperCase();
            const wasFav = favoritesSet.has(key);
            if (wasFav) favoritesSet.delete(key);
            else favoritesSet.add(key);
            if (!saveFavoritesToStorage()) {
                if (wasFav) favoritesSet.add(key);
                else favoritesSet.delete(key);
                alert('浏览器本地存储(Local Storage)不可用，无法使用收藏功能。');
                return;
            }
            if (favoritesSet.size === 0 && playScope === 'favorites') setPlayScope('all');
            updatePlayFavoritesButton();
            syncPlaybackOptions();
            playlistRenderKey = '';
            if (viewPlaylist.classList.contains('is-open')) renderPlaylist();
            renderBulkCache();
        }

        function isFavorite(bvid) {
            return !!(bvid && favoritesSet.has((bvid || '').toUpperCase()));
        }

        function updatePlayFavoritesButton() {
            const btn = document.getElementById('btn-play-favorites');
            if (btn) btn.style.display = favoritesSet.size > 0 ? '' : 'none';
        }

        function updatePlayDownloadsButton() {
            const btn = document.getElementById('btn-play-downloads');
            const hasDownloads = cachedBvidsSet && cachedBvidsSet.size > 0;
            if (btn) btn.style.display = hasDownloads ? '' : 'none';
            if (!hasDownloads && playScope === 'downloaded') setPlayScope('all');
            syncPlaybackOptions();
        }

        // --- 1.5.2 设置（Cookie）与自定义歌单（Local Storage）---
        const SETTINGS_COOKIE = CONFIG.settingsCookie;
        const SETTINGS_MAX_AGE = 365 * 24 * 60 * 60;
        const CUSTOM_STORAGE_KEY = CONFIG.storageKeys.custom;

        function getSettingsFromCookie() {
            const fallback = {
                showMain: true,
                showLive: false,
                showCustom: false,
                version: null,
                audioMode: 'medium',
                mediaSession: 'on',
                pipSetting: 'off',
                lockscreenLyric: 'off',
                cacheEnabled: 'off'
            };
            try {
                let raw = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(SETTINGS_COOKIE + '='));
                if (!raw && SETTINGS_COOKIE === 'sg_settings') {
                    const previous = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('sg_settings_fiona='));
                    if (previous) {
                        raw = SETTINGS_COOKIE + '=' + previous.slice(previous.indexOf('=') + 1);
                        document.cookie = raw + '; path=/; max-age=' + SETTINGS_MAX_AGE + '; SameSite=Lax';
                    }
                }
                if (!raw) return fallback;
                const value = decodeURIComponent((raw.indexOf('=') >= 0 ? raw.substring(raw.indexOf('=') + 1) : '').trim());
                const o = JSON.parse(value || '{}');
                return {
                    showMain: o.showMain !== false,
                    showLive: o.showLive === true,
                    showCustom: !!o.showCustom,
                    version: o.version || null,
                    audioMode: ['low', 'medium', 'high'].indexOf(o.audioMode) >= 0 ? o.audioMode : 'medium',
                    mediaSession: o.mediaSession === 'off' ? 'off' : 'on',
                    pipSetting: o.pipSetting === 'on' ? 'on' : 'off',
                    lockscreenLyric: o.lockscreenLyric === 'on' ? 'on' : 'off',
                    cacheEnabled: o.cacheEnabled === 'on' ? 'on' : 'off'
                };
            } catch (e) { return fallback; }
        }

        function saveSettingsToCookie(settings) {
            try {
                const value = encodeURIComponent(JSON.stringify(settings));
                document.cookie = SETTINGS_COOKIE + '=' + value + '; path=/; max-age=' + SETTINGS_MAX_AGE + '; SameSite=Lax';
                return true;
            } catch (e) { return false; }
        }

        function getCustomFromStorage() {
            try {
                const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
                if (!raw) return [];
                const arr = JSON.parse(raw);
                return Array.isArray(arr) ? arr.filter(x => x && (x.name || x.bvid)) : [];
            } catch (e) { return []; }
        }

        function saveCustomToStorage(list) {
            try {
                localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(list));
                return true;
            } catch (e) { return false; }
        }

        /**
         * 从旧版 Cookie 迁移到 Local Storage（仅当新存储为空且旧 Cookie 有数据时执行）。
         * 下一版推送可注释掉下方调用即可关闭迁移。
         */
        function migrateCookieToLocalStorage() {
            var favRaw = document.cookie.split(';').map(function (s) { return s.trim(); }).find(function (s) { return s.startsWith(FAV_STORAGE_KEY + '='); });
            var customRaw = document.cookie.split(';').map(function (s) { return s.trim(); }).find(function (s) { return s.startsWith(CUSTOM_STORAGE_KEY + '='); });
            var oldFavArr = [];
            var oldCustomArr = [];
            try {
                if (favRaw) {
                    var favVal = decodeURIComponent((favRaw.indexOf('=') >= 0 ? favRaw.substring(favRaw.indexOf('=') + 1) : '').trim());
                    var arr = JSON.parse(favVal || '[]');
                    if (Array.isArray(arr)) oldFavArr = arr.filter(Boolean);
                }
            } catch (e) {}
            try {
                if (customRaw) {
                    var customVal = decodeURIComponent((customRaw.indexOf('=') >= 0 ? customRaw.substring(customRaw.indexOf('=') + 1) : '').trim());
                    var arr = JSON.parse(customVal || '[]');
                    if (Array.isArray(arr)) oldCustomArr = arr.filter(function (x) { return x && (x.name || x.bvid); });
                }
            } catch (e) {}
            var newFavEmpty = !localStorage.getItem(FAV_STORAGE_KEY) || localStorage.getItem(FAV_STORAGE_KEY) === '[]' || localStorage.getItem(FAV_STORAGE_KEY) === '';
            var newCustomEmpty = !localStorage.getItem(CUSTOM_STORAGE_KEY) || localStorage.getItem(CUSTOM_STORAGE_KEY) === '[]' || localStorage.getItem(CUSTOM_STORAGE_KEY) === '';
            var hasOldData = oldFavArr.length > 0 || oldCustomArr.length > 0;
            if (newFavEmpty && newCustomEmpty && hasOldData) {
                if (oldFavArr.length > 0) localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(oldFavArr));
                if (oldCustomArr.length > 0) localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(oldCustomArr));
                var favCount = oldFavArr.length;
                var customCount = oldCustomArr.length;
                console.log('[存储迁移] 已从 Cookie 迁移至 Local Storage：收藏 ' + favCount + ' 首，自定义歌曲 ' + customCount + ' 首。');
                alert('站点已更新存储方式，检测到旧存储方式，已成功将' + favCount + '首收藏歌曲，' + customCount + '首自定义歌曲转移为新存储方式。更新详情见日志。');
            }
        }
        migrateCookieToLocalStorage(); // 下一版推送可注释掉本行以关闭迁移

        favoritesSet = getFavoritesFromStorage();
        updatePlayFavoritesButton();

        // --- 1.6 歌单与视图 ---
        let songList = [];
        let mainList = [];
        let liveList = [];
        let customList = [];
        let catalogPlaylists = [];
        let settings = getSettingsFromCookie();
        let cachedBvidsSet = new Set();
        const favoritesImporter = window.SG_FAVORITES_IMPORT.create({
            client: biliClient,
            getExisting: function () { return typeof getImportTargetSongs === 'function' ? getImportTargetSongs() : []; },
            onOpen: function () { if (typeof populateImportTargets === 'function') populateImportTargets(); },
            onImport: function (songs, source) { return importFavoritePlaylist(songs, source); },
            onComplete: function (count) {
                document.getElementById('settings-modal-backdrop').classList.remove('is-open');
                openCollection(lastImportedPlaylist);
                showToast('已导入 ' + count + ' 首歌曲到歌单。', 4500);
            },
        });
        let playlistRevision = 0;
        let playlistSortedItems = null;
        let playlistRenderKey = '';
        const playlistRows = new Map();
        const playlistCollator = new Intl.Collator('zh-CN');

        const viewHome = document.getElementById('view-home');
        const viewPlaylist = document.getElementById('view-playlist');
        const viewPlay = document.getElementById('view-play');
        const playlistListEl = document.getElementById('playlist-list');
        const playlistCountEl = document.getElementById('playlist-count');
        const playlistBackdrop = document.getElementById('playlist-backdrop');
        const playSongNameEl = document.getElementById('play-song-name');
        const homePlayerEl = document.getElementById('home-now-playing');
        const homePlayerTitleEl = document.getElementById('home-now-playing-title');
        const homePlayerStatusEl = document.getElementById('home-now-playing-status');
        const homePlayerToggleEl = document.getElementById('home-now-playing-toggle');
        const homePlayerProgressEl = document.getElementById('home-now-playing-progress');
        const playbackRecoveryEl = document.getElementById('playback-recovery');

        function showView(which) {
            viewHome.classList.toggle('view-home', true);
            viewHome.style.display = which === 'home' ? 'block' : 'none';
            viewPlaylist.classList.toggle('is-open', which === 'playlist');
            const isPlay = which === 'play';
            viewPlay.classList.toggle('is-active', isPlay);

            // 播放页才展示黑胶并允许旋转；离开播放页时停止旋转
            if (characterImg) {
                characterImg.classList.toggle('in-play-view', isPlay);
                if (!isPlay) {
                    stopVisuals();
                    characterImg.classList.remove('is-playing');
                }
            }
            syncHomePlayer();
        }

        function syncHomePlayer() {
            if (!homePlayerEl) return;
            const saved = !currentPlayingBvid && resumeSession && songList.some(song => song.bvid === resumeSession.bvid) ? resumeSession : null;
            const id = loadingBvid || currentPlayingBvid || (saved && saved.bvid);
            homePlayerEl.hidden = !id;
            viewHome.classList.toggle('has-now-playing', !!id);
            if (!id) return;
            const name = getSongNameByBvid(id);
            const status = loadingBvid ? '正在加载' : saved ? '上次听到 ' + formatTime(saved.time) + ' · 点击继续' : failedPlaybackBvid === id ? '暂时无法播放' : bgmAudio.paused ? '已暂停' : '正在播放';
            if (homePlayerTitleEl.textContent !== name) homePlayerTitleEl.textContent = name;
            if (homePlayerStatusEl.textContent !== status) homePlayerStatusEl.textContent = status;
            const open = document.getElementById('home-now-playing-open');
            open.setAttribute('aria-label', (saved ? '继续播放' : '打开歌曲') + '《' + name + '》' + (saved ? '' : '的播放页'));
            homePlayerToggleEl.classList.toggle('is-playing', !bgmAudio.paused && !loadingBvid);
            homePlayerToggleEl.disabled = !!loadingBvid;
            homePlayerToggleEl.setAttribute('aria-label', loadingBvid ? '正在加载歌曲' : bgmAudio.paused ? '继续播放' : '暂停播放');
            syncHomePlayerProgress();
        }

        function syncHomePlayerProgress() {
            if (!homePlayerEl || homePlayerEl.hidden || viewHome.style.display === 'none' || document.hidden) return;
            if (!currentPlayingBvid && resumeSession) {
                const progress = resumeSession.duration > 0 ? Math.min(1, resumeSession.time / resumeSession.duration) : 0;
                homePlayerProgressEl.style.transform = 'scaleX(' + progress + ')';
                return;
            }
            const duration = bgmAudio.duration;
            const progress = (!loadingBvid || loadingBvid === currentPlayingBvid) && isFinite(duration) && duration > 0
                ? Math.max(0, Math.min(1, bgmAudio.currentTime / duration)) : 0;
            homePlayerProgressEl.style.transform = 'scaleX(' + progress + ')';
        }

        function savePlaybackSession(force) {
            if (!currentPlayingBvid || sessionAudioBvid !== currentPlayingBvid ||
                (pendingPlayback && (!pendingPlayback.started || pendingPlayback.time > 0 && !pendingPlayback.positionApplied)) || !Number.isFinite(bgmAudio.currentTime)) return;
            if (!force && Date.now() - lastSessionWrite < 5000) return;
            const session = { bvid: currentPlayingBvid, time: bgmAudio.currentTime,
                duration: isFinite(bgmAudio.duration) ? bgmAudio.duration : 0, scope: playScope, order: playMode };
            try {
                localStorage.setItem(PLAY_SESSION_STORAGE_KEY, JSON.stringify(session));
                resumeSession = session;
                lastSessionWrite = Date.now();
            } catch (_) {}
        }

        function applyResumePosition() {
            if (!pendingPlayback || !pendingPlayback.ready || pendingPlayback.positionApplied || sessionAudioBvid !== currentPlayingBvid || bgmAudio.readyState < 1) return;
            const time = window.SG_PLAYBACK_STATE.resumeTime(pendingPlayback.time, bgmAudio.duration);
            if (time === null) return;
            try {
                // 新音频已经从 0 开始，避免 WebKit 为一次无意义的 seek 阻塞 play()。
                if (time !== 0 || bgmAudio.currentTime > 0.1) bgmAudio.currentTime = time;
                pendingPlayback.positionApplied = true;
            } catch (_) {}
        }

        function rememberStartedPlayback() {
            if (!pendingPlayback || !pendingPlayback.ready || pendingPlayback.bvid !== currentPlayingBvid || pendingPlayback.started || pendingPlayback.version !== playRequestVersion || sessionAudioBvid !== currentPlayingBvid) return;
            applyResumePosition();
            pendingPlayback.started = true;
            const startedSong = getSongInfo(currentPlayingBvid);
            randomQueue.commit(currentPlayingBvid, pendingPlayback.direction);
            if (pendingPlayback.queueEntryId) listeningLibrary.startQueued(pendingPlayback.queueEntryId, pendingPlayback.queueAnchor);
            else if (!pendingPlayback.preserveQueueAnchor) listeningLibrary.leaveQueue();
            listeningLibrary.record(startedSong);
            savePlaybackSession(true);
        }

        async function resumeLastPlayback() {
            const saved = resumeSession;
            if (!saved || !songList.some(song => song.bvid === saved.bvid)) return;
            setPlayScope(saved.scope);
            setPlayMode(saved.order);
            showView('play');
            return playMusic(saved.bvid, { resumeTime: saved.time, preserveQueueAnchor: true });
        }

        function clearPlaybackError() {
            failedPlaybackBvid = '';
            failedPlaybackKind = '';
            if (playbackRecoveryEl) playbackRecoveryEl.hidden = true;
            syncHomePlayer();
        }

        async function retryPlayback() {
            const bvid = failedPlaybackBvid;
            if (!bvid) return;
            const resumeDirectly = failedPlaybackKind === 'autoplay' && bvid === currentPlayingBvid && bgmAudio.src;
            const time = bvid === currentPlayingBvid && sessionAudioBvid === bvid ? bgmAudio.currentTime
                : pendingPlayback && pendingPlayback.bvid === bvid ? pendingPlayback.time : 0;
            clearPlaybackError();
            if (!resumeDirectly) return playMusic(bvid, { resumeTime: time,
                queueEntryId: pendingPlayback && pendingPlayback.bvid === bvid ? pendingPlayback.queueEntryId : null });
            try {
                await bgmAudio.play();
                rememberStartedPlayback();
                updatePlayPauseIcon();
            } catch (error) { handlePlayError(bvid, error); }
        }

        function playNextAfterFailure() {
            const failed = failedPlaybackBvid;
            const failedEntry = listeningLibrary.list('queue').find(item => item.bvid === failed);
            if (failedEntry) listeningLibrary.remove(failedEntry.id);
            const queued = getQueuedNext();
            if (queued) { playMusic(queued.bvid, { direction: 'forward', queueEntryId: queued.id }); return; }
            const list = getEffectiveList();
            if (!list.some(song => song.bvid && song.bvid !== failed)) return;
            const index = list.findIndex(song => song.bvid === failed);
            let next;
            if (playMode === 'random') {
                randomQueue.skip(failed);
                const id = randomQueue.peekNext(list.filter(song => song.bvid !== failed && !listeningLibrary.isExcluded(song.bvid)).map(song => song.bvid), currentPlayingBvid);
                next = list.find(song => song.bvid === id);
            } else {
                for (let offset = 1; offset <= list.length; offset++) {
                    const candidate = list[(index + offset) % list.length];
                    if (candidate.bvid && candidate.bvid !== failed) { next = candidate; break; }
                }
            }
            if (next) playMusic(next.bvid, { direction: 'forward' });
        }

        const playlistSearchEl = document.getElementById('playlist-search');
        const playlistFilterBtn = document.getElementById('playlist-filter-btn');
        let playlistFilterFavorites = false;
        let playlistTab = 'collections';

        function openPlaylist(focusIndex, tab) {
            if (tab) playlistTab = tab;
            syncLibraryTabs();
            if (playlistSearchEl) playlistSearchEl.value = '';
            renderPlaylist();
            if (window.SG_CACHE && window.SG_CACHE.supported && typeof window.SG_CACHE.listCachedBvids === 'function') {
                window.SG_CACHE.listCachedBvids().then(function (arr) {
                    cachedBvidsSet = new Set((arr || []).map(function (b) { return String(b || ''); }));
                    updatePlayDownloadsButton();
                    renderPlaylist();
                }).catch(function () { });
            }
            viewPlaylist.classList.add('is-open');
            // 等 DOM 渲染完成后再滚动到当前播放行
            const scrollToIdx = focusIndex != null && focusIndex >= 0 ? focusIndex : getCurrentIndex();
            requestAnimationFrame(function () {
                if (playlistTab !== 'songs') return;
                const item = browsedPlaylistId ? playlistListEl.querySelector('.playlist-item[data-bvid="' + currentPlayingBvid + '"]')
                    : playlistListEl.querySelector(`[data-index="${scrollToIdx}"]`);
                if (item) item.scrollIntoView({ block: 'center', behavior: 'instant' });
            });
        }

        function closePlaylist() {
            showView(viewPlay.classList.contains('is-active') ? 'play' : 'home');
        }

        function getSongInfo(bvid) {
            return songList.find(song => song.bvid === bvid) || mainList.find(song => song.bvid === bvid) ||
                liveList.find(song => song.bvid === bvid) || customList.find(song => song.bvid === bvid) ||
                listeningLibrary.list('recent').find(song => song.bvid === bvid) || listeningLibrary.list('queue').find(song => song.bvid === bvid) ||
                listeningLibrary.list('excluded').find(song => song.bvid === bvid) || { bvid: bvid, name: bvid };
        }

        function getQueuedNext() {
            return listeningLibrary.list('queue').find(item => playScope !== 'downloaded' || cachedBvidsSet.has(item.bvid)) || null;
        }

        function getRandomList() {
            return getEffectiveList().filter(song => !listeningLibrary.isExcluded(song.bvid));
        }

        function syncLibraryTabs() {
            document.querySelectorAll('[data-library-tab]').forEach(function (button) {
                const tab = button.dataset.libraryTab;
                button.setAttribute('aria-pressed', String(tab === playlistTab));
                if (tab === 'queue') button.textContent = '待播' + (listeningLibrary.list('queue').length ? ' ' + listeningLibrary.list('queue').length : '');
            });
            const clear = document.getElementById('library-clear');
            if (clear) {
                clear.hidden = !['queue', 'recent'].includes(playlistTab);
                clear.textContent = playlistTab === 'queue' ? '清空待播' : '清空记录';
            }
            if (typeof syncCollectionToolbar === 'function') syncCollectionToolbar();
            const hint = document.getElementById('library-hint');
            if (hint) {
                hint.parentElement.hidden = ['songs', 'collections'].includes(playlistTab);
                hint.hidden = ['songs', 'collections'].includes(playlistTab);
                hint.textContent = ({ queue: playScope === 'downloaded' ? '下载模式下仅播放已缓存的待播歌曲，听完接回原来的顺序。' : '待播歌曲优先播放，听完接回原来的顺序。',
                    recent: '保留最近听过的 100 首歌曲，可搜索、播放或收藏。', excluded: '这些歌曲不参与随机，仍可手动播放；在更多操作中随时恢复。' })[playlistTab] || '';
            }
        }

        function renderLibraryPlaylist(query) {
            const source = listeningLibrary.list(playlistTab);
            const items = source.filter(song => (!query || (song.name || '').toLowerCase().includes(query) || song.bvid.toLowerCase().includes(query)) &&
                (!playlistFilterFavorites || isFavorite(song.bvid)));
            playlistCountEl.textContent = query || playlistFilterFavorites ? items.length + ' / ' + source.length : String(source.length);
            playlistAlphaBarEl.replaceChildren();
            const fragment = document.createDocumentFragment();
            items.forEach(song => {
                const entry = { ...song, queueEntryId: playlistTab === 'queue' ? song.id : null };
                fragment.appendChild(createPlaylistItemEl(entry, playlistTab + ':' + (song.id || song.bvid), currentPlayingBvid));
            });
            if (!items.length) {
                const empty = document.createElement('p'); empty.className = 'library-empty';
                empty.textContent = query || playlistFilterFavorites ? '没有找到符合条件的歌曲。' : ({ queue: '还没有待播歌曲。在歌曲右侧点“···”，即可加入。', recent: '听过的歌曲会出现在这里。', excluded: '还没有排除歌曲。' })[playlistTab];
                fragment.appendChild(empty);
            }
            playlistListEl.replaceChildren(fragment);
        }

        let actionSongBvid = '', actionQueueId = null, actionPlaylistId = '';
        function openSongActions(bvid, queueId) {
            actionSongBvid = bvid; actionQueueId = queueId || null; actionPlaylistId = playlistTab === 'songs' ? browsedPlaylistId : '';
            const dialog = document.getElementById('song-actions-dialog');
            document.getElementById('song-actions-title').textContent = getSongNameByBvid(bvid);
            document.querySelector('[data-song-action="favorite"]').textContent = isFavorite(bvid) ? '取消收藏' : '收藏歌曲';
            document.querySelector('[data-song-action="exclude"]').textContent = listeningLibrary.isExcluded(bvid) ? '恢复参与随机' : '不参与随机';
            const queue = listeningLibrary.list('queue'), index = queue.findIndex(item => item.id === actionQueueId);
            ['up', 'down', 'remove'].forEach(function (action) {
                const button = document.querySelector('[data-song-action="' + action + '"]');
                button.hidden = index < 0;
                button.disabled = action === 'up' && index === 0 || action === 'down' && index === queue.length - 1;
            });
            if (typeof configureCollectionSongActions === 'function') configureCollectionSongActions(bvid);
            if (!dialog.open) dialog.showModal();
        }

        function changeSongAction(action) {
            const song = getSongInfo(actionSongBvid);
            if (action === 'playlist' || action.startsWith('playlist-')) { handleCollectionSongAction(action, song); return; }
            if (action === 'next' || action === 'append') {
                if (playScope === 'downloaded' && !cachedBvidsSet.has(song.bvid)) { showToast('下载模式下，请先缓存这首歌，或切换为全部歌曲。'); return; }
                if (!listeningLibrary.add(song, action === 'next')) { showToast('待播队列已满，请先移除一些歌曲。'); return; }
                invalidateNextPlayback();
                showToast(action === 'next' ? '已设为下一首播放。' : '已加入待播队列。');
            } else if (action === 'favorite') { toggleFavorite(song.bvid); updateFavButton(); }
            else if (action === 'exclude') {
                const excluded = !listeningLibrary.isExcluded(song.bvid);
                listeningLibrary.exclude(song, excluded);
                clearPreload(); stopInitialPreload(); preloadScheduledForBvid = null;
                if (!currentPlayingBvid) runInitialPreload();
                showToast(excluded ? '已不参与随机，手动点播仍可播放。' : '已恢复参与随机。');
            } else if (action === 'remove') { listeningLibrary.remove(actionQueueId); invalidateNextPlayback(); }
            else if (action === 'up' || action === 'down') { listeningLibrary.move(actionQueueId, action === 'up' ? -1 : 1); invalidateNextPlayback(); }
            document.getElementById('song-actions-dialog').close();
        }

        // ── 拼音首字母工具 ────────────────────────────────────────────
        function getSongSortLetter(name) {
            if (!name) return '#';
            var first = name.trim().charAt(0);
            if (!first) return '#';
            // 尝试用 pinyinUtil 获取首字母
            if (window.pinyinUtil) {
                try {
                    var fl = pinyinUtil.getFirstLetter(first);
                    if (fl) first = fl.charAt(0).toUpperCase();
                } catch (e) {}
            }
            if (/^[A-Za-z]$/.test(first)) return first.toUpperCase();
            return '#';
        }

        // ── 字母索引栏 ────────────────────────────────────────────────
        const playlistAlphaBarEl = document.getElementById('playlist-alpha-bar');

        function renderAlphaBar(activeLetters) {
            if (!playlistAlphaBarEl) return;
            playlistAlphaBarEl.innerHTML = '';
            const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
            all.forEach(function (letter) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'alpha-bar-item' + (activeLetters.has(letter) ? ' has-items' : ' no-items');
                btn.textContent = letter;
                btn.dataset.letter = letter;
                if (activeLetters.has(letter)) {
                    btn.addEventListener('click', function () {
                        var anchor = playlistListEl.querySelector('[data-alpha-group="' + letter + '"]');
                        if (anchor) anchor.scrollIntoView({ block: 'start', behavior: 'smooth' });
                        // 高亮当前激活字母
                        playlistAlphaBarEl.querySelectorAll('.alpha-bar-item').forEach(function (el) {
                            el.classList.toggle('active', el.dataset.letter === letter);
                        });
                    });
                }
                playlistAlphaBarEl.appendChild(btn);
            });
        }

        // ── 创建单个歌单条目 DOM ──────────────────────────────────────
        function createPlaylistItemEl(s, i, curBvid) {
            const isCurrent = (s.bvid || '') === curBvid;
            const state = [isCurrent, isFavorite(s.bvid), cachedBvidsSet.has(s.bvid || ''), listeningLibrary.isExcluded(s.bvid), s.name, s.playedAt || ''].join(':');
            const cached = playlistRows.get(i);
            if (cached && cached.state === state) return cached.element;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'playlist-item' + (isCurrent ? ' current' : '');
            btn.dataset.bvid = s.bvid || '';
            btn.dataset.index = i;
            if (s.queueEntryId) btn.dataset.queueEntryId = s.queueEntryId;

            // 左侧主内容：歌名 + 徽标（用户、自定义、LIVE），结构对齐 tmp/playlist.html
            const mainWrap = document.createElement('span');
            mainWrap.className = 'playlist-item-main';

            const nameEl = document.createElement('span');
            nameEl.className = 'playlist-item-name';
            nameEl.textContent = s.name || s.title || '';
            const copy = document.createElement('span');
            copy.className = 'playlist-item-copy';
            copy.appendChild(nameEl);
            if (s.playedAt || listeningLibrary.isExcluded(s.bvid)) {
                const meta = document.createElement('small');
                meta.className = 'playlist-item-meta';
                meta.textContent = [s.playedAt ? new Date(s.playedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
                    listeningLibrary.isExcluded(s.bvid) ? '不参与随机' : ''].filter(Boolean).join(' · ');
                copy.appendChild(meta);
            }
            mainWrap.appendChild(copy);

            const isCached = !!(s.bvid && cachedBvidsSet && cachedBvidsSet.has(s.bvid || ''));
            if (s.isCustom) {
                const userIcon = document.createElement('span');
                userIcon.className = 'playlist-item-user-icon';
                userIcon.setAttribute('aria-label', '用户');
                userIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="100%" height="100%"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
                mainWrap.appendChild(userIcon);
            }
            if (s.isLive) {
                const liveTag = document.createElement('span');
                liveTag.className = 'playlist-item-live-tag';
                liveTag.textContent = 'Live';
                mainWrap.appendChild(liveTag);
            }
            btn.appendChild(mainWrap);

            const rightWrap = document.createElement('span');
            rightWrap.className = 'playlist-item-right';

            if (isCached) {
                const cachedIcon = document.createElement('span');
                cachedIcon.className = 'playlist-item-download';
                cachedIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 13 9 17 19 7"></polyline></svg>';
                rightWrap.appendChild(cachedIcon);
            }

            if (isFavorite(s.bvid)) {
                const starEl = document.createElement('span');
                starEl.className = 'playlist-item-heart';
                starEl.setAttribute('aria-hidden', 'true');
                starEl.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
                rightWrap.appendChild(starEl);
            }

            btn.appendChild(rightWrap);
            const row = document.createElement('div');
            row.className = 'playlist-entry';
            row.appendChild(btn);
            const more = document.createElement('button');
            more.type = 'button'; more.className = 'playlist-more'; more.textContent = '···';
            more.setAttribute('aria-label', '《' + (s.name || s.bvid) + '》的更多操作');
            more.dataset.bvid = s.bvid;
            if (s.queueEntryId) more.dataset.queueEntryId = s.queueEntryId;
            row.appendChild(more);
            playlistRows.set(i, { state: state, element: row });
            return row;
        }

        // 列表节点会复用，统一监听点击，避免每次渲染创建一批闭包。
        if (playlistListEl) playlistListEl.addEventListener('click', function (event) {
            const more = event.target.closest('.playlist-more');
            if (more) { openSongActions(more.dataset.bvid, more.dataset.queueEntryId); return; }
            const item = event.target.closest('.playlist-item');
            if (!item || !playlistListEl.contains(item)) return;
            if (playlistTab === 'songs') setPlaybackPlaylist(browsedPlaylistId);
            playMusic(item.dataset.bvid || '', { queueEntryId: item.dataset.queueEntryId });
            closePlaylist();
            showView('play');
        });

        function renderPlaylist() {
            if (!playlistListEl) return;
            const query = (playlistSearchEl && playlistSearchEl.value || '').trim().toLowerCase();
            const renderKey = JSON.stringify([playlistRevision, query, playlistFilterFavorites, currentPlayingBvid,
                Array.from(favoritesSet), Array.from(cachedBvidsSet), playlistTab, listeningLibrary.revision, personalLibrary.revision, browsedPlaylistId]);
            if (renderKey === playlistRenderKey) return;
            playlistRenderKey = renderKey;
            syncLibraryTabs();
            if (playlistTab === 'collections') { if (typeof renderPersonalCollections === 'function') renderPersonalCollections(query); return; }
            if (playlistTab !== 'songs') { renderLibraryPlaylist(query); return; }
            if (browsedPlaylistId && typeof renderCollectionSongs === 'function') { renderCollectionSongs(query); return; }
            if (!playlistSortedItems) {
                playlistSortedItems = songList.map(function (s, i) {
                    s._sortKey = getSongSortLetter(s.name || s.title || '');
                    s._searchName = (s.name || s.title || '').toLowerCase();
                    return { s: s, i: i };
                }).sort(function (a, b) {
                    const la = a.s._sortKey, lb = b.s._sortKey;
                    if (la === '#' && lb !== '#') return 1;
                    if (la !== '#' && lb === '#') return -1;
                    if (la !== lb) return la < lb ? -1 : 1;
                    return playlistCollator.compare(a.s.name || '', b.s.name || '');
                });
            }
            let items = playlistSortedItems;
            if (playlistFilterFavorites) items = items.filter(({ s }) => isFavorite(s.bvid));
            const total = items.length;

            // ── 搜索 / 收藏模式：原有逻辑，无分组 ──────────────────
            if (query) {
                items = items.filter(({ s }) => s._searchName.includes(query) || s.bvid.toLowerCase().includes(query));
                items.sort((a, b) => {
                    const na = a.s._searchName;
                    const nb = b.s._searchName;
                    const aStart = na.startsWith(query) ? 0 : 1;
                    const bStart = nb.startsWith(query) ? 0 : 1;
                    if (aStart !== bStart) return aStart - bStart;
                    return na.localeCompare(nb);
                });
                if (playlistCountEl) playlistCountEl.textContent = items.length + ' / ' + total;
                const curBvid = currentPlayingBvid || '';
                const fragment = document.createDocumentFragment();
                items.forEach(({ s, i }) => fragment.appendChild(createPlaylistItemEl(s, i, curBvid)));
                playlistListEl.replaceChildren(fragment);
                if (playlistAlphaBarEl) playlistAlphaBarEl.innerHTML = '';
                return;
            }

            // ── 普通模式：A-Z 分组排序 ───────────────────────────────
            if (playlistCountEl) playlistCountEl.textContent = total;

            // 收集实际存在的字母
            const activeLetters = new Set(items.map(({ s }) => s._sortKey));
            renderAlphaBar(activeLetters);

            // 渲染分组
            const curBvid = currentPlayingBvid || '';
            let lastLetter = null;
            const frag = document.createDocumentFragment();
            items.forEach(({ s, i }) => {
                const letter = s._sortKey;
                if (letter !== lastLetter) {
                    const heading = document.createElement('div');
                    heading.className = 'playlist-group-heading';
                    heading.textContent = letter;
                    heading.dataset.alphaGroup = letter;
                    frag.appendChild(heading);
                    lastLetter = letter;
                }
                frag.appendChild(createPlaylistItemEl(s, i, curBvid));
            });
            playlistListEl.replaceChildren(frag);
        }

        function buildSongList() {
            const records = [
                ...mainList.map(s => ({ name: s.name || s.title, bvid: s.bvid, isCustom: false, isLive: false })),
                ...liveList.map(s => ({ name: s.name || s.title, bvid: s.bvid, isCustom: false, isLive: true })),
                ...customList.map(s => ({ name: s.name, bvid: s.bvid, isCustom: true, isLive: false })),
                ...personalLibrary.allSongs().map(s => ({ ...s, isCustom: true, isLive: false })),
            ];
            const seen = new Set();
            const out = records.filter(s => {
                const key = (s.bvid || '').toUpperCase();
                if (!/^BV[0-9a-zA-Z]{10}$/.test(s.bvid) || seen.has(key)) return false;
                seen.add(key); return true;
            });
            // 手动修改的歌名优先于预置标题，并保证旧数据也有可搜索的名称。
            const customNames = new Map(customList.map(song => [(song.bvid || '').toUpperCase(), song]));
            out.forEach(s => {
                const custom = customNames.get(s.bvid.toUpperCase());
                s.name = String(custom ? custom.name || custom.title || s.name || s.bvid : s.name || s.bvid);
                if (custom) s.isCustom = true;
                s._sortKey = undefined;
            });
            songList = out;
            playlistRevision++;
            playlistSortedItems = null;
            playlistRows.clear();
            syncHomePlayer();
            syncPlaybackOptions();
        }

        async function loadSongs() {
            const fallbackList = [
  {
    "name": "探窗",
    "bvid": "BV1Sf421Q7Rt"
  },
  {
    "name": "如果可以",
    "bvid": "BV1Cn4y1o7yG"
  },
  {
    "name": "天空没有极限",
    "bvid": "BV1SM4m1U7SL"
  },
  {
    "name": "开往早晨的午夜",
    "bvid": "BV1MM4m1U7ve"
  },
  {
    "name": "明月天涯",
    "bvid": "BV1E1421b7h9"
  },
  {
    "name": "乘风",
    "bvid": "BV1K6421f7kA"
  },
  {
    "name": "风情万种",
    "bvid": "BV1s6421f7Pj"
  },
  {
    "name": "百利甜",
    "bvid": "BV1x2421Z7tm"
  },
  {
    "name": "绝不绝",
    "bvid": "BV1Ef421B7SU"
  },
  {
    "name": "像你这样的朋友",
    "bvid": "BV1U4421Z7Yj"
  },
  {
    "name": "画心",
    "bvid": "BV1Qf421q76D"
  },
  {
    "name": "苦茶（男声版）",
    "bvid": "BV1n5steeET8"
  },
  {
    "name": "苦茶（女声版）",
    "bvid": "BV1r5steeEKU"
  },
  {
    "name": "女儿情",
    "bvid": "BV1FLsNevENy"
  },
  {
    "name": "暮色回响",
    "bvid": "BV1S7pteyEUc"
  },
  {
    "name": "水星记",
    "bvid": "BV1TotneYEuJ"
  },
  {
    "name": "如愿",
    "bvid": "BV1qhx4eoEWV"
  },
  {
    "name": "小美满",
    "bvid": "BV1X2SBYfEeg"
  },
  {
    "name": "爱情",
    "bvid": "BV1T3zmYJEz9"
  },
  {
    "name": "11",
    "bvid": "BV1BtqdYQEae"
  },
  {
    "name": "圣诞结",
    "bvid": "BV1GskZYcEfp"
  },
  {
    "name": "虚构",
    "bvid": "BV1zzc2edEyX"
  },
  {
    "name": "世界赠予我的",
    "bvid": "BV19JwoeVEuw"
  },
  {
    "name": "绝世舞姬",
    "bvid": "BV1hMTvzJEo9"
  },
  {
    "name": "起风了",
    "bvid": "BV1WvK2zqEBo"
  },
  {
    "name": "爱的天灵灵",
    "bvid": "BV1TPgPzYE4S"
  },
  {
    "name": "逆光",
    "bvid": "BV1fv61B4Evn"
  }
];
            const lists = await Promise.all([
                fetch('./songs.json').then(r => r.ok ? r.json() : null).catch(() => null),
                fetch('./songs_live.json').then(r => r.ok ? r.json() : null).catch(() => null),
                fetch('./catalogs/fiona.json').then(r => r.ok ? r.json() : null).catch(() => null),
                fetch('./catalogs/fiona-live.json').then(r => r.ok ? r.json() : null).catch(() => null)
            ]);
            catalogPlaylists = [
                { id: 'builtin-gladys', name: '思诺 · 精选', profile: 'gladys', songs: window.SG_PERSONAL.songs(Array.isArray(lists[0]) && lists[0].length ? lists[0] : fallbackList) },
                { id: 'builtin-fiona', name: '心宜 · 精选', profile: 'fiona', songs: window.SG_PERSONAL.songs(lists[2]) },
                { id: 'builtin-gladys-live', name: '思诺 · Live', profile: 'gladys', songs: window.SG_PERSONAL.songs(lists[1]) },
                { id: 'builtin-fiona-live', name: '心宜 · Live', profile: 'fiona', songs: window.SG_PERSONAL.songs(lists[3]) },
            ];
            mainList = [...catalogPlaylists[0].songs, ...catalogPlaylists[1].songs];
            liveList = [...catalogPlaylists[2].songs, ...catalogPlaylists[3].songs];
            customList = getCustomFromStorage();
            buildSongList();
            if (typeof validatePlaybackPlaylist === 'function') validatePlaybackPlaylist();
            renderPlaylist();
            runInitialPreload();
            if (legacyMigrationError || personalLibrary.error) showToast(legacyMigrationError || personalLibrary.error, 7000);
        }

        function syncSettingsToggles() {
            const tMain = document.getElementById('toggle-show-main');
            const tLive = document.getElementById('toggle-show-live');
            const tCustom = document.getElementById('toggle-show-custom');
            if (tMain) tMain.classList.toggle('is-on', settings.showMain);
            if (tLive) tLive.classList.toggle('is-on', settings.showLive);
            if (tCustom) tCustom.classList.toggle('is-on', settings.showCustom);
        }

        /** 更新某个 segmented-control 的滑块位置与宽度，使之与当前激活按钮对齐 */
        function updateSegmentedSlider(container) {
            if (!container) return;
            const slider = container.querySelector('.seg-slider');
            const activeBtn = container.querySelector('.seg-btn.is-active') || container.querySelector('.seg-btn');
            if (!slider || !activeBtn) return;
            const rectContainer = container.getBoundingClientRect();
            const rectBtn = activeBtn.getBoundingClientRect();
            const left = rectBtn.left - rectContainer.left;
            slider.style.width = rectBtn.width + 'px';
            slider.style.transform = 'translateX(' + left + 'px)';
        }

        // function syncMediaSessionButtons() {
        //     const mode = (settings && settings.mediaSession) || 'on';
        //     document.querySelectorAll('.btn-mediasession').forEach(function (btn) {
        //         const isActive = btn.getAttribute('data-mode') === mode;
        //         btn.classList.toggle('is-active', isActive);
        //     });
        //     document.querySelectorAll('.segmented-control .btn-mediasession').forEach(function (btn) {
        //         updateSegmentedSlider(btn.closest('.segmented-control'));
        //     });
        // }

        // function syncPipSettingButtons() {
        //     const mode = (settings && settings.pipSetting) || 'off';
        //     document.querySelectorAll('.btn-pip-setting').forEach(function (btn) {
        //         const isActive = btn.getAttribute('data-mode') === mode;
        //         btn.classList.toggle('is-active', isActive);
        //     });
        //     document.querySelectorAll('.segmented-control .btn-pip-setting').forEach(function (btn) {
        //         updateSegmentedSlider(btn.closest('.segmented-control'));
        //     });
        //     // 按设置显隐小窗按钮（同时需要浏览器支持 API）
        //     const pipBtn = document.getElementById('btn-pip');
        //     if (pipBtn) {
        //         const supported = 'documentPictureInPicture' in window;
        //         pipBtn.style.display = (supported && mode === 'on') ? '' : 'none';
        //     }
        // }

        // function syncLockscreenLyricButtons() {
        //     const mode = (settings && settings.lockscreenLyric) || 'off';
        //     document.querySelectorAll('.btn-lockscreen-lyric').forEach(function (btn) {
        //         const isActive = btn.getAttribute('data-mode') === mode;
        //         btn.classList.toggle('is-active', isActive);
        //     });
        //     document.querySelectorAll('.segmented-control .btn-lockscreen-lyric').forEach(function (btn) {
        //         updateSegmentedSlider(btn.closest('.segmented-control'));
        //     });
        // }

        // --- 系统交互 Toggle 化同步函数 ---
        function syncMediaSessionButtons() {
            const mode = (settings && settings.mediaSession) || 'on';
            const btn = document.getElementById('toggle-mediasession');
            if (btn) btn.classList.toggle('is-on', mode === 'on');
        }
        const tMedia = document.getElementById('toggle-mediasession');
        if (tMedia) tMedia.addEventListener('click', function () {
            settings.mediaSession = settings.mediaSession === 'off' ? 'on' : 'off';
            saveSettingsToCookie(settings);
            syncMediaSessionButtons();
            updateMediaSession();
        });

        function syncPipSettingButtons() {
            const mode = (settings && settings.pipSetting) || 'off';
            const btn = document.getElementById('toggle-pip-setting');
            if (btn) btn.classList.toggle('is-on', mode === 'on');
            // 按设置显隐主页的小窗按钮
            const pipBtn = document.getElementById('btn-pip');
            if (pipBtn) {
                const supported = 'documentPictureInPicture' in window;
                pipBtn.style.display = (supported && mode === 'on') ? '' : 'none';
            }
        }
        const tPip = document.getElementById('toggle-pip-setting');
        if (tPip) tPip.addEventListener('click', function () {
            settings.pipSetting = settings.pipSetting === 'off' ? 'on' : 'off';
            saveSettingsToCookie(settings);
            syncPipSettingButtons();
            if (settings.pipSetting === 'off' && pipWindow) { pipWindow.close(); }
        });

        function syncLockscreenLyricButtons() {
            const mode = (settings && settings.lockscreenLyric) || 'off';
            const btn = document.getElementById('toggle-lockscreen-lyric');
            if (btn) btn.classList.toggle('is-on', mode === 'on');
        }
        const tLockLyric = document.getElementById('toggle-lockscreen-lyric');
        if (tLockLyric) tLockLyric.addEventListener('click', function () {
            settings.lockscreenLyric = settings.lockscreenLyric === 'off' ? 'on' : 'off';
            saveSettingsToCookie(settings);
            syncLockscreenLyricButtons();
            updateMediaSession();
        });

        function syncCacheButtons() {
            const mode = (settings && settings.cacheEnabled) || 'off';
            document.querySelectorAll('.btn-cache-setting').forEach(function (btn) {
                const m = btn.getAttribute('data-mode') || 'off';
                const isActive = m === mode;
                btn.classList.toggle('is-active', isActive);
            });
            document.querySelectorAll('.segmented-control .btn-cache-setting').forEach(function (btn) {
                updateSegmentedSlider(btn.closest('.segmented-control'));
            });
        }

        function formatBytes(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        }

        async function refreshStorageUsageDisplay() {
            var el = document.getElementById('storage-usage-display');
            if (!el) return;

            var lines = [];

            // 本地歌单存储（LocalStorage）：以 5 MB 为预估上限显示百分比
            var lsBytes = 0;
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    lsBytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
                }
            } catch (e) {}
            var LS_QUOTA = 5 * 1024 * 1024;
            var lsPct = Math.min((lsBytes / LS_QUOTA * 100), 100).toFixed(1);
            lines.push('本地歌单存储：' + formatBytes(lsBytes) + ' / 5 MB (' + lsPct + '%)，');

            // 本地歌词存储（IndexedDB）
            var idbBytes = 0;
            if (window.SG_LYRICS && window.SG_LYRICS.supported) {
                try {
                    idbBytes = await window.SG_LYRICS.estimateIdbBytes();
                    lines.push('本地歌词存储：' + formatBytes(idbBytes) + '，');
                } catch (e) {}
            }

            // 本地音频缓存（IndexedDB）
            var cacheBytes = 0;
            if (window.SG_CACHE && window.SG_CACHE.supported && typeof window.SG_CACHE.estimateCacheBytes === 'function') {
                try {
                    cacheBytes = await window.SG_CACHE.estimateCacheBytes();
                    lines.push('本地音频缓存：' + formatBytes(cacheBytes) + '，');
                } catch (e) {}
            }

            // storage.estimate()：浏览器整体估算
            if (navigator.storage && navigator.storage.estimate) {
                try {
                    var est = await navigator.storage.estimate();
                    var used = est.usage || 0;   // 整个站点总使用
                    var quota = est.quota || 0;
                    if (used > 0) {
                        // 其他 = 总使用 - （本地歌单存储 + 本地歌词存储 + 本地音频缓存）
                        var known = lsBytes + (idbBytes || 0) + (cacheBytes || 0);
                        var other = used - known;
                        if (other < 0) other = 0;
                        var pct = quota > 0 ? ((other / quota) * 100).toFixed(1) : null;
                        var usedGB = (other / (1024 * 1024 * 1024)).toFixed(2);
                        var quotaGB = quota > 0 ? (quota / (1024 * 1024 * 1024)).toFixed(2) : null;
                        lines.push('浏览器估算其他已用：' + usedGB + ' GB' +
                            (quotaGB !== null ? ' / ' + quotaGB + ' GB' + (pct !== null ? ' (' + pct + '%)' : '') : ''));
                    }
                } catch (e) {}
            }

            el.innerHTML = lines.map(function (l) {
                return '<span>' + l + '</span>';
            }).join('');
        }

        function syncQualityButtons() {
            const mode = (settings && settings.audioMode) || 'medium';
            const buttons = document.querySelectorAll('.btn-quality');
            buttons.forEach(function (btn) {
                const m = btn.getAttribute('data-mode') || 'medium';
                const isActive = m === mode;
                btn.classList.toggle('is-active', isActive);
            });
            // 更新对应 segmented-control 滑块
            document.querySelectorAll('.segmented-control .btn-quality').forEach(function (btn) {
                updateSegmentedSlider(btn.closest('.segmented-control'));
            });
        }

        /** 设置页「自定义歌曲」区：无歌曲时只显示添加 + 导入/导出；有歌曲时 添加/管理 + 导入/导出 并排 */
        /** 设置页「自定义歌曲」区：改为 iOS Action Row 规范排版 */
        /** 设置页「自定义歌曲」区：使用 2x2 高级网格排版 */
        function renderCustomSectionInSettings() {
            const container = document.getElementById('custom-section-buttons');
            if (!container) return;
            
            container.parentElement.style.padding = '0';
            container.parentElement.style.borderBottom = 'none';
            // 【关键修复】：强制父容器拉伸，让网格铺满宽度
            container.parentElement.style.alignItems = 'stretch';
            
            if(container.previousElementSibling) container.previousElementSibling.style.display = 'none';

            let html = '<div class="custom-actions-grid">';

            // 1. 添加歌曲
            html += '<div class="btn-custom-action" id="btn-add-custom">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
                    '<span>添加歌曲</span></div>';

            // 2. 管理歌曲（有歌时显示，无歌时用占位或其他布局）
            if (customList.length > 0) {
                html += '<div class="btn-custom-action" id="btn-manage-custom">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' +
                        '<span>管理歌曲</span></div>';
            }

            // 3. 导入歌单
            html += '<div class="btn-custom-action" id="btn-import-custom">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
                    '<span>导入歌单</span></div>';

            html += '<button type="button" class="btn-custom-action" id="btn-import-bilibili">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="5" width="18" height="16" rx="4"/><path d="m7 2 3 3m7-3-3 3M8 11v4m8-4v4"/></svg>' +
                    '<span>从 B 站导入</span></button>';

            // 4. 导出歌单
            html += '<div class="btn-custom-action" id="btn-export-custom">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                    '<span>导出歌单</span></div>';

            html += '</div><input type="file" id="input-import-custom" accept=".txt" style="display:none">';

            container.innerHTML = html;

            // 重新绑定事件
            const btnAdd = container.querySelector('#btn-add-custom');
            if (btnAdd) btnAdd.addEventListener('click', () => openCustomForm());
            const btnManage = container.querySelector('#btn-manage-custom');
            if (btnManage) btnManage.addEventListener('click', openCustomManage);
            const btnExport = container.querySelector('#btn-export-custom');
            if (btnExport) btnExport.addEventListener('click', exportCustomSongsToFile);
            const btnBilibili = container.querySelector('#btn-import-bilibili');
            if (btnBilibili) btnBilibili.addEventListener('click', favoritesImporter.open);

            const fileInput = container.querySelector('#input-import-custom');
            const btnImport = container.querySelector('#btn-import-custom');
            if (btnImport && fileInput) {
                btnImport.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', function () {
                    if (!this.files || !this.files.length) return;
                    importCustomSongsFromFile(this.files[0]);
                    this.value = '';
                });
            }
        }

        /** 导出自定义歌单到 txt 文件（JSON 内容） */
        function exportCustomSongsToFile() {
            if (!customList.length) {
                alert('当前没有自定义歌曲可导出。');
                return;
            }
            const data = customList.map(function (item) {
                return { name: item.name || '', bvid: item.bvid || '' };
            });
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = CONFIG.exportFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        /** 从 txt(JSON) 文件导入自定义歌单，追加且去重 */
        function importCustomSongsFromFile(file) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const text = String(e.target && e.target.result || '').trim();
                    const parsed = JSON.parse(text);
                    if (!Array.isArray(parsed)) throw new Error();

                    const existingSet = new Set(
                        customList
                            .map(function (x) { return (x.bvid || '').trim().toUpperCase(); })
                            .filter(Boolean)
                    );

                    let duplicateCount = 0;
                    const duplicateNames = [];
                    const toAppend = [];

                    parsed.forEach(function (item) {
                        if (!item) return;
                        const name = String(item.name || item.title || '').trim();
                        const bvid = window.SG_BILI_API.normalizeId(item.bvid);
                        if (!name || !isValidBvidFormat(bvid)) return;
                        const key = bvid.toUpperCase();
                        if (existingSet.has(key)) {
                            duplicateCount += 1;
                            duplicateNames.push(name);
                            return;
                        }
                        existingSet.add(key);
                        toAppend.push({ name: name, bvid: bvid });
                    });

                    if (!toAppend.length && duplicateCount === 0) {
                        alert('导入歌单的格式错误。');
                        return;
                    }

                    if (toAppend.length) {
                        Array.prototype.push.apply(customList, toAppend);
                        saveCustomToStorage(customList);
                        buildSongList();
                        renderPlaylist();
                        renderCustomSectionInSettings();
                    }

                    if (duplicateCount > 0) {
                        let msg = '导入完成，其中 ' + duplicateCount + ' 首歌曲已存在，未重复导入：\n';
                        duplicateNames.slice(0, 50).forEach(function (name) {
                            msg += '- ' + name + '\n';
                        });
                        if (duplicateNames.length > 50) {
                            msg += '... 等共 ' + duplicateNames.length + ' 首\n';
                        }
                        msg += '\n如果需要重复添加，请手动添加。';
                        alert(msg);
                    } else {
                        alert('导入成功，共追加 ' + toAppend.length + ' 首自定义歌曲。');
                    }
                } catch (err) {
                    alert('导入歌单的格式错误。');
                }
            };
            reader.readAsText(file, 'utf-8');
        }

        function openCustomManage() {
            const backdrop = document.getElementById('custom-manage-backdrop');
            const searchEl = document.getElementById('custom-manage-search');
            if (searchEl) searchEl.value = '';
            renderCustomManageList('');
            backdrop.classList.add('is-open');
        }

        function closeCustomManage() {
            document.getElementById('custom-manage-backdrop').classList.remove('is-open');
        }

        /** 管理弹层内的列表，支持搜索（按歌名或 bvid） */
        function renderCustomManageList(query) {
            const listEl = document.getElementById('custom-manage-list');
            if (!listEl) return;
            const alphaBarEl = document.getElementById('custom-manage-alpha-bar');
            const q = (query || '').trim().toLowerCase();
            let items = customList.map((item, idx) => ({ item, idx })).filter(function (x) {
                if (!q) return true;
                return (x.item.name || '').toLowerCase().includes(q) || (x.item.bvid || '').toLowerCase().includes(q);
            });

            listEl.innerHTML = '';

            function appendRow(x) {
                const row = document.createElement('div');
                row.className = 'custom-manage-item';
                row.innerHTML =
                    '<span class="name"></span>' +
                    '<span class="bvid"></span>' +
                    '<button type="button" class="btn-edit">修改</button>' +
                    '<button type="button" class="btn-del">删除</button>' +
                    '<span class="del-confirm-bar"><span class="del-confirm-label">确定删除？</span>' +
                    '<button type="button" class="btn-del-yes">删除</button>' +
                    '<button type="button" class="btn-del-no">取消</button></span>';
                row.querySelector('.name').textContent = x.item.name || '—';
                row.querySelector('.name').title = x.item.name || '';
                row.querySelector('.bvid').textContent = x.item.bvid || '';
                row.querySelector('.btn-edit').addEventListener('click', function (e) { e.stopPropagation(); closeCustomManage(); openCustomForm(x.idx); });
                row.querySelector('.btn-del').addEventListener('click', function (e) {
                    e.stopPropagation();
                    row.classList.add('del-confirm-open');
                });
                row.querySelector('.btn-del-no').addEventListener('click', function (e) {
                    e.stopPropagation();
                    row.classList.remove('del-confirm-open');
                });
                row.querySelector('.btn-del-yes').addEventListener('click', function (e) {
                    e.stopPropagation();
                    var delBvid = x.item.bvid || '';
                    customList.splice(x.idx, 1);
                    saveCustomToStorage(customList);
                    buildSongList();
                    renderPlaylist();
                    renderCustomManageList(document.getElementById('custom-manage-search').value);
                    if (customList.length === 0) { closeCustomManage(); renderCustomSectionInSettings(); }
                    if (delBvid && !songList.some(song => song.bvid === delBvid) && window.SG_LYRICS && window.SG_LYRICS.supported) {
                        window.SG_LYRICS.deleteUserLrc(delBvid).catch(function () {});
                    }
                });
                return row;
            }

            // 搜索模式：不分组，不显示字母栏
            if (q) {
                items.forEach(function (x) { listEl.appendChild(appendRow(x)); });
                if (alphaBarEl) alphaBarEl.innerHTML = '';
                return;
            }

            // 普通模式：A-Z 分组
            items.forEach(function (x) {
                if (!x.item._sortKey) x.item._sortKey = getSongSortLetter(x.item.name || '');
            });
            items.sort(function (a, b) {
                const la = a.item._sortKey, lb = b.item._sortKey;
                if (la === '#' && lb !== '#') return 1;
                if (la !== '#' && lb === '#') return -1;
                if (la !== lb) return la < lb ? -1 : 1;
                return (a.item.name || '').localeCompare(b.item.name || '', 'zh-CN');
            });

            // 字母索引栏
            const activeLetters = new Set(items.map(function (x) { return x.item._sortKey; }));
            if (alphaBarEl) {
                alphaBarEl.innerHTML = '';
                'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').forEach(function (letter) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'alpha-bar-item' + (activeLetters.has(letter) ? ' has-items' : ' no-items');
                    btn.textContent = letter;
                    btn.dataset.letter = letter;
                    if (activeLetters.has(letter)) {
                        btn.addEventListener('click', function () {
                            var anchor = listEl.querySelector('[data-alpha-group="' + letter + '"]');
                            if (anchor) anchor.scrollIntoView({ block: 'start', behavior: 'smooth' });
                            alphaBarEl.querySelectorAll('.alpha-bar-item').forEach(function (el) {
                                el.classList.toggle('active', el.dataset.letter === letter);
                            });
                        });
                    }
                    alphaBarEl.appendChild(btn);
                });
            }

            const frag = document.createDocumentFragment();
            let lastLetter = null;
            items.forEach(function (x) {
                const letter = x.item._sortKey;
                if (letter !== lastLetter) {
                    const heading = document.createElement('div');
                    heading.className = 'custom-manage-group-heading';
                    heading.textContent = letter;
                    heading.dataset.alphaGroup = letter;
                    frag.appendChild(heading);
                    lastLetter = letter;
                }
                frag.appendChild(appendRow(x));
            });
            listEl.appendChild(frag);
        }

        const customSongEntry = window.SG_SONG_ENTRY.create({
            input: document.getElementById('custom-form-bvid'), name: document.getElementById('custom-form-name'),
            status: document.getElementById('custom-form-info-status'), retry: document.getElementById('custom-form-info-retry'),
            client: biliClient, find: id => songList.find(song => song.bvid.toUpperCase() === id.toUpperCase()),
        });
        let customFormTargetPlaylist = '', customFormVersion = 0, customFormSaving = false;

        function openCustomForm(editIndex, targetPlaylist) {
            customFormTargetPlaylist = targetPlaylist || ''; customFormVersion++;
            const formVersion = customFormVersion;
            const backdrop = document.getElementById('custom-form-backdrop');
            const title = document.getElementById('custom-form-title');
            const nameIn = document.getElementById('custom-form-name');
            const bvidIn = document.getElementById('custom-form-bvid');
            const lyricsIn = document.getElementById('custom-form-lyrics');
            if (editIndex != null && editIndex >= 0 && customList[editIndex]) {
                title.textContent = '修改自定义歌曲';
                nameIn.value = customList[editIndex].name || '';
                bvidIn.value = customList[editIndex].bvid || '';
                nameIn.dataset.editIndex = String(editIndex);
                // 异步读取已有歌词回填
                if (lyricsIn && window.SG_LYRICS && window.SG_LYRICS.supported) {
                    lyricsIn.value = '';
                    lyricsIn.placeholder = '加载中…';
                    window.SG_LYRICS.getUserLrc(customList[editIndex].bvid || '').then(function (lrc) {
                        if (formVersion !== customFormVersion || !backdrop.classList.contains('is-open')) return;
                        if (!lyricsIn.value) lyricsIn.value = lrc || '';
                        lyricsIn.placeholder = '[00:00.00] 第一行歌词\n[00:05.00] 第二行歌词\n留空则不修改已有歌词';
                    }).catch(() => { if (formVersion === customFormVersion) lyricsIn.placeholder = '已有歌词暂时无法读取，可留空保留原歌词。'; });
                } else if (lyricsIn) {
                    lyricsIn.value = '';
                }
            } else {
                title.textContent = targetPlaylist ? '添加到歌单' : '添加自定义歌曲';
                nameIn.value = '';
                bvidIn.value = '';
                if (lyricsIn) lyricsIn.value = '';
                delete nameIn.dataset.editIndex;
            }
            customSongEntry.begin();
            document.getElementById('custom-form-submit').disabled = false;
            backdrop.classList.add('is-open');
            setTimeout(() => { if (formVersion === customFormVersion && backdrop.classList.contains('is-open')) (editIndex == null ? bvidIn : nameIn).focus(); }, 100);
        }

        function closeCustomForm() {
            customSongEntry.close(); customFormVersion++;
            document.getElementById('custom-form-backdrop').classList.remove('is-open');
            const target = customFormTargetPlaylist; customFormTargetPlaylist = '';
            if (target && personalLibrary.get(target) && typeof renderCollectionAdd === 'function') {
                renderCollectionAdd(); document.getElementById('collection-add-dialog').showModal();
            }
        }

        function isValidBvidFormat(bvid) {
            return !!window.SG_BILI_API.normalizeId(bvid);
        }

        /** 校验 BV 号；网络或上游风控异常时返回 unknown，不误判为无效视频。 */
        async function validateBvidExists(bvid) {
            try {
                return await biliClient.validate(bvid);
            } catch (e) { return 'unknown'; }
        }

        async function submitCustomForm() {
            if (customFormSaving) return;
            const button = document.getElementById('custom-form-submit'), session = customSongEntry.session;
            const nameIn = document.getElementById('custom-form-name'), lyricsIn = document.getElementById('custom-form-lyrics');
            const editIndex = nameIn.dataset.editIndex != null ? parseInt(nameIn.dataset.editIndex, 10) : -1;
            const targetPlaylist = customFormTargetPlaylist, lrcText = lyricsIn ? lyricsIn.value.trim() : '';
            customFormSaving = true; button.disabled = true; button.textContent = '正在添加…';
            try {
                const song = await customSongEntry.read();
                if (!song || !customSongEntry.current(session)) return;
                const { name, bvid } = song;
                const result = song.verified ? 'valid' : await validateBvidExists(bvid);
                if (!customSongEntry.current(session)) return;
                if (result === 'invalid') throw new Error('视频不存在、已删除或编号无效，请检查 BV 号。');
                if (result === 'unknown' && !confirm('暂时无法验证该视频（可能因网络或 B 站服务异常），是否仍要添加？')) return;
                const duplicate = customList.findIndex((item, i) => i !== editIndex && String(item.bvid || '').toUpperCase() === bvid.toUpperCase());
                const next = customList.slice();
                if (editIndex >= 0 && editIndex < next.length) {
                    if (duplicate >= 0) throw new Error('这首歌已经在自定义歌曲中。');
                    next[editIndex] = { name, bvid };
                } else if (duplicate < 0) next.push({ name, bvid });
                if (targetPlaylist) {
                    if (!personalLibrary.get(targetPlaylist)) throw new Error('这个歌单已被删除，请重新选择。');
                    personalLibrary.add(targetPlaylist, [{ name, bvid }]);
                } else {
                    if (!saveCustomToStorage(next)) throw new Error('保存失败，请检查设备空间后重试。');
                    customList = next;
                }
                buildSongList(); renderPlaylist(); renderCustomSectionInSettings();
                if (lrcText && window.SG_LYRICS && window.SG_LYRICS.supported) {
                    try { await window.SG_LYRICS.saveUserLrc(bvid, lrcText); }
                    catch (_) { showToast('歌曲已添加，但歌词未能保存，请稍后重新导入。', 5000); }
                    if (currentPlayingBvid === bvid) lyricsReloadForCurrentSong();
                }
                if (customSongEntry.current(session)) closeCustomForm();
                showToast(targetPlaylist ? '已加入歌单。' : duplicate >= 0 && editIndex < 0 ? '这首歌已经在自定义歌曲中。' : '歌曲已保存。');
            } catch (error) {
                if (customSongEntry.current(session)) document.getElementById('custom-form-info-status').textContent = error.message || '添加失败，请重试。';
            } finally {
                customFormSaving = false; button.disabled = false; button.textContent = '确定';
            }
        }

        loadSongs();

        let hasNewVersionFlag = false;

        // 定时关闭：最长 24 小时
        let sleepTimerDeadline = null;      // 时间戳（ms），null 表示未设置
        let sleepTimerTimeoutId = null;     // 真正触发关闭的定时器
        let sleepTimerIntervalId = null;    // 每秒刷新剩余时间显示
        const SLEEP_TIMER_MAX_MS = 24 * 60 * 60 * 1000;

        function clearSleepTimerJobs() {
            if (sleepTimerTimeoutId != null) {
                clearTimeout(sleepTimerTimeoutId);
                sleepTimerTimeoutId = null;
            }
            if (sleepTimerIntervalId != null) {
                clearInterval(sleepTimerIntervalId);
                sleepTimerIntervalId = null;
            }
        }

        function updateSleepTimerLabel() {
            const label = document.getElementById('sleep-timer-label');
            if (!label) return;
            if (!sleepTimerDeadline) {
                label.textContent = '定时关闭';
                return;
            }
            const remaining = sleepTimerDeadline - Date.now();
            if (remaining <= 0) {
                sleepTimerDeadline = null;
                label.textContent = '定时关闭';
                return;
            }
            const totalSeconds = Math.floor(remaining / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            label.textContent =
                '定时关闭(剩余: ' +
                minutes +
                ' 分钟 ' +
                (seconds < 10 ? '0' : '') +
                seconds +
                ' 秒)';
        }

        function applySleepTimerMs(ms) {
            clearSleepTimerJobs();
            sleepTimerDeadline = null;
            if (!ms || ms <= 0) {
                updateSleepTimerLabel();
                return;
            }
            if (ms > SLEEP_TIMER_MAX_MS) ms = SLEEP_TIMER_MAX_MS;
            sleepTimerDeadline = Date.now() + ms;
            updateSleepTimerLabel();

            sleepTimerTimeoutId = setTimeout(function () {
                clearSleepTimerJobs();
                sleepTimerDeadline = null;
                updateSleepTimerLabel();
                
                // 执行关闭逻辑
                if (!bgmAudio.paused) {
                    bgmAudio.pause();
                    stopVisuals();
                    updatePlayPauseIcon();
                    updateMediaSession(); // 同步系统控制中心
                }
                
                // 优化：使用你的 Toast 替代原生 alert
                showToast('定时关闭时间已到，播放已自动暂停。');
            }, ms);

            // 每秒更新一次设置菜单里的剩余时间文字
            sleepTimerIntervalId = setInterval(function () {
                if (!sleepTimerDeadline || (sleepTimerDeadline - Date.now() <= 0)) {
                    clearSleepTimerJobs();
                    return;
                }
                updateSleepTimerLabel();
            }, 1000);
        }

        function initVersionIndicators() {
            const storedVersion = settings && settings.version;
            if (!storedVersion || storedVersion !== CURRENT_VERSION) {
                hasNewVersionFlag = true;
                const btnHome = document.getElementById('btn-settings-home');
                const btnPlay = document.getElementById('btn-settings-play');
                if (btnHome) btnHome.classList.add('has-new');
                if (btnPlay) btnPlay.classList.add('has-new');
            }
        }

        function openChangelog() {
            const backdrop = document.getElementById('changelog-backdrop');
            if (!backdrop) return;
            const body = backdrop.querySelector('.changelog-body');
            if (body && window.SG_CHANGELOG_HTML) {
                body.innerHTML = window.SG_CHANGELOG_HTML;
            }
            backdrop.classList.add('is-open');
            
            // 【修复 1】：隐藏设置菜单里面的小圆点
            const badge = document.getElementById('settings-badge-new');
            if (badge) badge.style.display = 'none';
            
            // 【修复 2】：精确消除主页和播放页齿轮上的小红点
            const btnHome = document.getElementById('btn-settings-home');
            const btnPlay = document.getElementById('btn-settings-play');
            if (btnHome) btnHome.classList.remove('has-new');
            if (btnPlay) btnPlay.classList.remove('has-new');

            if (hasNewVersionFlag) {
                hasNewVersionFlag = false;
                settings.version = CURRENT_VERSION;
                saveSettingsToCookie(settings);
            }
        }

        function closeChangelog() {
            const backdrop = document.getElementById('changelog-backdrop');
            if (backdrop) backdrop.classList.remove('is-open');
        }

        (function initSettingsUI() {
            const modalBackdrop = document.getElementById('settings-modal-backdrop');
            const modal = document.getElementById('settings-modal');
            const btnSettingsHome = document.getElementById('btn-settings-home');
            const btnSettingsPlay = document.getElementById('btn-settings-play');
            if (!modalBackdrop || !modal || !btnSettingsHome || !btnSettingsPlay) return;
            function openSettings() {
                settings = getSettingsFromCookie();
                syncSettingsToggles();
                renderCustomSectionInSettings();
                syncQualityButtons();
                syncMediaSessionButtons();
                syncPipSettingButtons();
                syncLockscreenLyricButtons();
                syncCacheButtons();
                refreshStorageUsageDisplay();
                modalBackdrop.classList.add('is-open');

                if (hasNewVersionFlag) {
                    // 让设置菜单里“更新日志”那一行的小红点显示
                    const badge = document.getElementById('settings-badge-new');
                    if (badge) badge.style.display = 'inline-block';
                    // 同时给主页/播放页的设置齿轮按钮加上呼吸效果类名
                    document.getElementById('btn-settings-home')?.classList.add('has-new');
                    document.getElementById('btn-settings-play')?.classList.add('has-new');
                }
            }
            function closeSettings() { modalBackdrop.classList.remove('is-open'); }
            btnSettingsHome.addEventListener('click', openSettings);
            btnSettingsPlay.addEventListener('click', openSettings);
            modalBackdrop.addEventListener('click', function (e) { if (e.target === modalBackdrop) closeSettings(); });
            modal.addEventListener('click', function (e) { e.stopPropagation(); });
            const btnCloseSettings = document.getElementById('btn-close-settings');
            if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettings);

            function flipToggle(id, key) {
                const btn = document.getElementById(id);
                if (!btn) return;
                btn.addEventListener('click', function () {
                    settings[key] = !settings[key];
                    saveSettingsToCookie(settings);
                    buildSongList();
                    renderPlaylist();
                    syncSettingsToggles();
                });
            }
            flipToggle('toggle-show-main', 'showMain');
            flipToggle('toggle-show-live', 'showLive');
            flipToggle('toggle-show-custom', 'showCustom');

            (function initQualityButtons() {
                const buttons = document.querySelectorAll('.btn-quality');
                if (!buttons.length) return;
                buttons.forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const mode = btn.getAttribute('data-mode') || 'medium';
                        if (settings.audioMode !== mode) {
                            clearPreload();
                            stopInitialPreload();
                            preloadScheduledForBvid = null;
                        }
                        settings.audioMode = mode;
                        saveSettingsToCookie(settings);
                        syncQualityButtons();
                        if (!currentPlayingBvid) runInitialPreload();
                    });
                });
            })();

            (function initMediaSessionButtons() {
                const buttons = document.querySelectorAll('.btn-mediasession');
                if (!buttons.length) return;
                buttons.forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const mode = btn.getAttribute('data-mode') || 'on';
                        settings.mediaSession = mode;
                        saveSettingsToCookie(settings);
                        syncMediaSessionButtons();
                        updateMediaSession();
                    });
                });
            })();

            (function initPipSettingButtons() {
                const buttons = document.querySelectorAll('.btn-pip-setting');
                if (!buttons.length) return;
                buttons.forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const mode = btn.getAttribute('data-mode') || 'off';
                        settings.pipSetting = mode;
                        saveSettingsToCookie(settings);
                        syncPipSettingButtons();
                        // 若正在 PiP 中且用户选择关闭，则关闭小窗
                        if (mode === 'off' && pipWindow) { pipWindow.close(); }
                    });
                });
            })();
            (function initLockscreenLyricButtons() {
                const buttons = document.querySelectorAll('.btn-lockscreen-lyric');
                if (!buttons.length) return;
                buttons.forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const mode = btn.getAttribute('data-mode') || 'off';
                        settings.lockscreenLyric = mode;
                        saveSettingsToCookie(settings);
                        syncLockscreenLyricButtons();
                        // 立即刷新 Media Session 标题
                        updateMediaSession();
                    });
                });
            })();
            (function initCachedBvidsFromIdb() {
                if (!window.SG_CACHE || !window.SG_CACHE.supported || typeof window.SG_CACHE.listCachedBvids !== 'function') return;
                window.SG_CACHE.listCachedBvids().then(function (arr) {
                    cachedBvidsSet = new Set((arr || []).map(function (b) { return String(b || ''); }));
                    updatePlayDownloadsButton();
                }).catch(function () { });
            })();
            (function initClearAudioCacheButton() {
                const btn = document.getElementById('btn-clear-audio-cache');
                if (!btn || !window.SG_CACHE || !window.SG_CACHE.supported || typeof window.SG_CACHE.clearAll !== 'function') return;
                btn.addEventListener('click', async function () {
                    if (!confirm('确定要清理所有音频缓存吗？这不会影响歌词、自定义歌曲或其他设置。')) return;
                    if (bulkCache) bulkCache.cancel();
                    if (cancelAudioCacheDownload) { cancelAudioCacheDownload(); cancelAudioCacheDownload = null; }
                    try {
                        await window.SG_CACHE.clearAll();
                        cachedBvidsSet.clear(); updatePlayDownloadsButton();
                        playlistRenderKey = '';
                        if (viewPlaylist.classList.contains('is-open')) renderPlaylist();
                        await refreshStorageUsageDisplay();
                        showToast('音频缓存已清理。', 2600);
                    } catch (e) {
                        showToast('清理音频缓存时出错，请稍后重试。', 2600);
                    }
                });
            })();
            (function initCacheButtons() {
                const buttons = document.querySelectorAll('.btn-cache-setting');
                if (!buttons.length) return;
                const backdrop = document.getElementById('cache-confirm-backdrop');
                const box = document.getElementById('cache-confirm-box');
                const btnOk = document.getElementById('cache-confirm-ok');
                const btnCancel = document.getElementById('cache-confirm-cancel');
                let pendingConfirm = null;

                function closeDialog() {
                    if (backdrop) backdrop.classList.remove('is-open');
                    pendingConfirm = null;
                }

                if (backdrop && box && btnOk && btnCancel) {
                    backdrop.addEventListener('click', function (e) {
                        if (e.target === backdrop) closeDialog();
                    });
                    box.addEventListener('click', function (e) { e.stopPropagation(); });
                    btnCancel.addEventListener('click', function () { closeDialog(); });
                    btnOk.addEventListener('click', function () {
                        if (pendingConfirm) pendingConfirm();
                        closeDialog();
                    });
                }

                buttons.forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const mode = btn.getAttribute('data-mode') || 'off';
                        if (mode === 'off') {
                            settings.cacheEnabled = 'off';
                            saveSettingsToCookie(settings);
                            syncCacheButtons();
                            return;
                        }
                        // mode === 'on'
                        if (!backdrop || !box || !btnOk || !btnCancel) {
                            settings.cacheEnabled = 'on';
                            saveSettingsToCookie(settings);
                            syncCacheButtons();
                            return;
                        }
                        pendingConfirm = function () {
                            settings.cacheEnabled = 'on';
                            saveSettingsToCookie(settings);
                            syncCacheButtons();
                        };
                        backdrop.classList.add('is-open');
                    });
                });
            })();
            // 定时关闭弹窗
            (function initSleepTimerDialog() {
                const btnOpen = document.getElementById('btn-open-sleep-timer');
                const backdrop = document.getElementById('sleep-timer-backdrop');
                const box = document.getElementById('sleep-timer-box');
                const inputHours = document.getElementById('sleep-hours-input');
                const inputMinutes = document.getElementById('sleep-minutes-input');
                const btnCancel = document.getElementById('sleep-timer-cancel');
                const btnConfirm = document.getElementById('sleep-timer-confirm');
                if (!btnOpen || !backdrop || !box || !inputHours || !inputMinutes || !btnCancel || !btnConfirm) return;

                function openDialog() {
                    if (sleepTimerDeadline) {
                        const remaining = Math.max(0, sleepTimerDeadline - Date.now());
                        const totalMinutes = Math.floor(remaining / 60000);
                        inputHours.value = Math.floor(totalMinutes / 60);
                        inputMinutes.value = totalMinutes % 60;
                    } else {
                        inputHours.value = '';
                        inputMinutes.value = '';
                    }
                    backdrop.classList.add('is-open');
                    setTimeout(function () { inputMinutes.focus(); }, 0);
                }

                function closeDialog() {
                    backdrop.classList.remove('is-open');
                }

                btnOpen.addEventListener('click', openDialog);
                btnCancel.addEventListener('click', function () { closeDialog(); });
                backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeDialog(); });
                box.addEventListener('click', function (e) { e.stopPropagation(); });

                const presetButtons = backdrop.querySelectorAll('.sleep-timer-preset');
                presetButtons.forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const mins = parseInt(btn.getAttribute('data-minutes'), 10) || 0;
                        inputHours.value = Math.floor(mins / 60);
                        inputMinutes.value = mins % 60;
                    });
                });

                btnConfirm.addEventListener('click', function () {
                    let h = parseInt(inputHours.value, 10) || 0;
                    let m = parseInt(inputMinutes.value, 10) || 0;
                    if (h < 0) h = 0;
                    if (m < 0) m = 0;
                    let totalMs = (h * 60 + m) * 60 * 1000;
                    if (totalMs > SLEEP_TIMER_MAX_MS) {
                        totalMs = SLEEP_TIMER_MAX_MS;
                    }
                    applySleepTimerMs(totalMs);
                    closeDialog();
                });
            })();

            const btnChangelog = document.getElementById('btn-changelog');
            if (btnChangelog) btnChangelog.addEventListener('click', openChangelog);

            const changelogBackdrop = document.getElementById('changelog-backdrop');
            if (changelogBackdrop) {
                changelogBackdrop.addEventListener('click', function (e) {
                    if (e.target === changelogBackdrop) closeChangelog();
                });
                const panel = changelogBackdrop.querySelector('.changelog-panel');
                if (panel) panel.addEventListener('click', function (e) { e.stopPropagation(); });
            }
            const btnCloseChangelog = document.getElementById('btn-close-changelog');
            if (btnCloseChangelog) btnCloseChangelog.addEventListener('click', closeChangelog);

            document.getElementById('custom-manage-backdrop').addEventListener('click', function (e) { if (e.target.id === 'custom-manage-backdrop') closeCustomManage(); });
            document.getElementById('custom-manage-panel').addEventListener('click', function (e) { e.stopPropagation(); });
            var manageCloseBtn = document.getElementById('custom-manage-close');
            if (manageCloseBtn) manageCloseBtn.addEventListener('click', closeCustomManage);
            var manageSearchEl = document.getElementById('custom-manage-search');
            if (manageSearchEl) manageSearchEl.addEventListener('input', function () { renderCustomManageList(this.value); });

            document.getElementById('custom-form-cancel').addEventListener('click', closeCustomForm);
            var customFormCancelFooter = document.getElementById('custom-form-cancel-footer');
            if (customFormCancelFooter) customFormCancelFooter.addEventListener('click', closeCustomForm);
            document.getElementById('custom-form-backdrop').addEventListener('click', function (e) { if (e.target.id === 'custom-form-backdrop') closeCustomForm(); });
            document.getElementById('custom-form-submit').addEventListener('click', submitCustomForm);
            for (const id of ['custom-form-bvid', 'custom-form-name']) document.getElementById(id).addEventListener('keydown', event => {
                if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submitCustomForm(); }
            });
            document.getElementById('custom-form-box').addEventListener('click', function (e) { e.stopPropagation(); });

            // 歌词字段：导入文件
            var lyricsImportBtn = document.getElementById('custom-form-lyrics-import-btn');
            var lyricsFileInput = document.getElementById('custom-form-lyrics-file-input');
            if (lyricsImportBtn && lyricsFileInput) {
                lyricsImportBtn.addEventListener('click', function () { lyricsFileInput.click(); });
                lyricsFileInput.addEventListener('change', function () {
                    var file = this.files && this.files[0];
                    if (!file) return;
                    var reader = new FileReader();
                    reader.onload = function (ev) {
                        var ta = document.getElementById('custom-form-lyrics');
                        if (ta) ta.value = ev.target.result || '';
                    };
                    reader.readAsText(file, 'UTF-8');
                    this.value = '';
                });
            }
        })();

        const btnOpenPlaylist = document.getElementById('btn-open-playlist');
        if (btnOpenPlaylist) {
            btnOpenPlaylist.addEventListener('click', () => openPlaylist(getCurrentIndex()));
        }

        const btnPlayRandom = document.getElementById('btn-play-random');
        if (btnPlayRandom) {
            btnPlayRandom.addEventListener('click', () => {
                if (!songList.length) return;
                setPlaybackPlaylist(''); setPlayScope('all');
                const bvid = getHomeRandomBvid();
                if (!bvid) { showToast('没有可随机播放的歌曲，可在歌单的“已排除”中恢复。'); return; }
                setPlayScope('all');
                setPlayMode('random');
                playMusic(bvid);
                showView('play');
            });
        }

        const btnPlayFavorites = document.getElementById('btn-play-favorites');
        if (btnPlayFavorites) {
            btnPlayFavorites.addEventListener('click', () => {
                setPlaybackPlaylist('');
                const favList = getFavoritesList();
                if (!favList.length) return;
                setPlayScope('favorites');
                playMusic(playMode === 'random' ? getNextBvid() : favList[0].bvid || '');
                showView('play');
            });
        }
        const btnPlayDownloads = document.getElementById('btn-play-downloads');
        if (btnPlayDownloads) {
            btnPlayDownloads.addEventListener('click', () => {
                setPlaybackPlaylist('');
                const dlList = getDownloadedList();
                if (!dlList.length) {
                    showToast('当前没有已下载歌曲', 2600);
                    return;
                }
                setPlayScope('downloaded');
                playMusic(playMode === 'random' ? getNextBvid() : dlList[0].bvid || '');
                showView('play');
            });
        }

        if (playlistBackdrop) {
            playlistBackdrop.addEventListener('click', closePlaylist);
        }
        const btnClosePlaylist = document.getElementById('btn-close-playlist');
        if (btnClosePlaylist) btnClosePlaylist.addEventListener('click', closePlaylist);

        const btnBackHome = document.getElementById('btn-back-home');
        if (btnBackHome) btnBackHome.addEventListener('click', function () {
            showView('home');
        });

        const btnOpenCatalog = document.getElementById('btn-open-catalog');
        if (btnOpenCatalog) {
            btnOpenCatalog.addEventListener('click', () => openPlaylist(getCurrentIndex()));
        }
        if (playlistSearchEl) playlistSearchEl.addEventListener('input', renderPlaylist);
        if (playlistFilterBtn) {
            playlistFilterBtn.addEventListener('click', () => {
                playlistFilterFavorites = !playlistFilterFavorites;
                playlistFilterBtn.classList.toggle('active', playlistFilterFavorites);
                playlistFilterBtn.title = playlistFilterFavorites ? '显示全部' : '只看收藏';
                renderPlaylist();
            });
        }

        // --- 2. 纯音乐播放逻辑 (核心) ---
        function createPlayerAudio() {
            const audio = new Audio();
            audio.crossOrigin = 'anonymous';
            audio.preload = 'auto';
            audio.playsInline = true;
            document.body.appendChild(audio);
            return audio;
        }
        let bgmAudio = createPlayerAudio();

        // ── 播放页 / 歌词页频谱（基于 Web Audio，与 bgmAudio 联动） ─────────────
        const playVisualizerEl = document.getElementById('play-visualizer');
        let audioCtx = null;
        let audioAnalyser = null;
        let audioSourceNode = null;
        let audioSourceEl = null;
        const iosVisualizer = window.SG_MOBILE_VISUALIZER.isIOS(navigator);
        const compactVisualizer = iosVisualizer || window.innerWidth <= 768 || window.matchMedia('(pointer: coarse)').matches;
        const reducedVisualizerMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        let mobileVisualizer = null;
        let analyserUnavailable = false;
        let lastVisualizerFrame = -Infinity;
        const audioSourceNodes = new WeakMap();
        let visualizerBars = [];
        let envelopeArray = [];
        // PiP 频谱容器与柱子（与主播放页共用同一个 Analyser 数据）
        let pipVisualizerEl = null;
        let pipVisualizerBars = [];
        let pipWindow = null;
        let visualizerRafId = null;
        let visualizerRafWindow = null;

        function ensureAudioAnalyser() {
            if (!playVisualizerEl) return;
            if (compactVisualizer && !mobileVisualizer) mobileVisualizer = window.SG_MOBILE_VISUALIZER.create(playVisualizerEl);
            if (mobileVisualizer) mobileVisualizer.resize();
            // iOS 原生 HLS 可能不给 Web Audio 提供样本，保留原始音频链路。
            if (iosVisualizer || reducedVisualizerMotion.matches || analyserUnavailable) return;
            if (!window.AudioContext && !window.webkitAudioContext) return;
            try {
                if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (!audioAnalyser) {
                    audioAnalyser = audioCtx.createAnalyser();
                    audioAnalyser.fftSize = compactVisualizer ? 512 : 2048;
                    audioAnalyser.smoothingTimeConstant = 0.8;
                }
                if (audioSourceEl !== bgmAudio) {
                    if (audioSourceNode) audioSourceNode.disconnect();
                    audioSourceNode = audioSourceNodes.get(bgmAudio);
                    if (!audioSourceNode) {
                        audioSourceNode = audioCtx.createMediaElementSource(bgmAudio);
                        audioSourceNodes.set(bgmAudio, audioSourceNode);
                    }
                    // 声音直接连到输出，分析器作为旁支，不成为绘制逻辑的依赖。
                    audioSourceNode.connect(audioCtx.destination);
                    audioSourceNode.connect(audioAnalyser);
                    audioSourceEl = bgmAudio;
                }
            } catch (error) {
                analyserUnavailable = true;
                console.warn('频谱不可用，保留轻量背景效果', error);
            }
            if (compactVisualizer) return;
            // --- 动态计算逻辑 ---
            const containerWidth = playVisualizerEl.offsetWidth;
            if (containerWidth === 0) return; // 【修复1】：防止在隐藏状态下宽度为0，导致柱形被清空

            const barWidth = 3;  // 与 CSS 一致
            const barGap = 2;    // margin 左右各 1px
            const newBarCount = Math.max(2, Math.floor(containerWidth / (barWidth + barGap)));

            // 如果数量没有变化，则不重新渲染 DOM，优化性能
            if (visualizerBars.length === newBarCount) return;

            // 清空原有柱子
            playVisualizerEl.innerHTML = '';
            visualizerBars = [];
            envelopeArray = []; // 清空重新计算

            // 根据新数量创建柱子
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < newBarCount; i++) {
                const bar = document.createElement('div');
                bar.className = 'bar';
                fragment.appendChild(bar);
                visualizerBars.push(bar);

                // 【性能优化】：只在初始化时计算一次正弦包络线！
                const envelope = 0.02 + 0.98 * Math.sin(Math.PI * (i / (newBarCount - 1)));
                envelopeArray.push(envelope);
            }
            playVisualizerEl.appendChild(fragment);
        }

        // --- 响应式监听 ---
        // 当用户缩放浏览器或旋转手机屏幕时，重新计算
        window.addEventListener('resize', () => {
            // 只有在播放页激活且有频谱显示需求时才重算
            if (viewPlay.classList.contains('is-active')) {
                ensureAudioAnalyser();
            }
        });

        function startAudioVisualizer() {
            if (bgmAudio.paused || (document.hidden && !pipWindow)) return;
            if (!viewPlay.classList.contains('is-active') && !pipWindow) return;
            if (!playVisualizerEl) return;
            ensureAudioAnalyser();
            if (reducedVisualizerMotion.matches) { if (mobileVisualizer) mobileVisualizer.reset(); return; }
            if ((!audioCtx || !audioAnalyser) && !mobileVisualizer) return;
            if (audioCtx && (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted')) {
                audioCtx.resume().catch(function () { });
            }
            const bufferLength = audioAnalyser ? audioAnalyser.frequencyBinCount : 0;
            // 提出来，防止重复创建
            if (!window.audioDataArray || window.audioDataArray.length !== bufferLength) {
                window.audioDataArray = new Uint8Array(bufferLength);
            }

            function renderFrame(timestamp) {
                visualizerRafId = null;
                if (bgmAudio.paused || (document.hidden && !pipWindow) ||
                    (!viewPlay.classList.contains('is-active') && !pipWindow)) return;
                // 【黑科技修复2】：当开启小窗时，强行征用小窗的 requestAnimationFrame！
                // 这样即使用户把主网页切到后台甚至最小化，小窗的频谱依然能保持 60 帧流畅跳动！
                const rafWindow = pipWindow || window;
                visualizerRafWindow = rafWindow;
                visualizerRafId = rafWindow.requestAnimationFrame(renderFrame);
                
                const now = typeof timestamp === 'number' ? timestamp : performance.now();
                const interval = compactVisualizer ? 1000 / 24 : 1000 / 60;
                if (now - lastVisualizerFrame < interval - 1) return;
                lastVisualizerFrame = Number.isFinite(lastVisualizerFrame)
                    ? now - Math.max(0, (now - lastVisualizerFrame) % interval) : now;
                if (audioAnalyser) audioAnalyser.getByteFrequencyData(window.audioDataArray);
                const usefulBins = audioAnalyser ? Math.floor(audioAnalyser.frequencyBinCount * 0.35) : 0;
                if (mobileVisualizer && !document.hidden && viewPlay.classList.contains('is-active')) {
                    mobileVisualizer.draw(audioAnalyser && audioCtx.state === 'running' ? window.audioDataArray : null,
                        now, bgmAudio.readyState >= 3 && !bgmAudio.seeking && !bgmAudio.ended && !mobileVisualizerWaiting,
                        viewPlay.classList.contains('is-lyrics-open'));
                }
                
                // === 独立渲染主界面频谱 ===
                if (!document.hidden && visualizerBars.length > 0 && viewPlay.classList.contains('is-active')) {
                    const isLyricsOpen = !!(viewPlay.classList.contains('is-lyrics-open'));
                    const intensity = isLyricsOpen ? 1.6 : 1.1;
                    const step = usefulBins / visualizerBars.length;
            
                    for (let i = 0; i < visualizerBars.length; i++) {
                        const startIdx = Math.floor(i * step);
                        const endIdx = Math.max(startIdx + 1, Math.floor((i + 1) * step)); 
                        let sum = 0;
                        for (let j = startIdx; j < endIdx; j++) sum += window.audioDataArray[j];
                        let value = (sum / (endIdx - startIdx)) / 255; 
                        value = Math.pow(value, 1.4);
                        
                        const envelope = envelopeArray[i] !== undefined ? envelopeArray[i] : (0.4 + 0.6 * Math.sin(Math.PI * (i / (visualizerBars.length - 1))));
                        value = value * envelope;
                        const scale = 0 + value * intensity;
                        visualizerBars[i].style.transform = `scaleY(${scale.toFixed(3)}) translateZ(0)`;
                    }
                }

                // === 独立渲染小窗 (PiP) 频谱 ===
                if (audioAnalyser && pipVisualizerBars && pipVisualizerBars.length > 0) {
                    const stepPip = usefulBins / pipVisualizerBars.length;
                    for (let i = 0; i < pipVisualizerBars.length; i++) {
                        const startIdx = Math.floor(i * stepPip);
                        const endIdx = Math.max(startIdx + 1, Math.floor((i + 1) * stepPip)); 
                        let sum = 0;
                        for (let j = startIdx; j < endIdx; j++) sum += window.audioDataArray[j];
                        let value = (sum / (endIdx - startIdx)) / 255; 
                        // 2. 【核心优化】：使用幂函数增加对比度，让凹凸更明显
                        // 指数越大，高低起伏越剧烈
                        value = Math.pow(value, 1.4);
                        
                        // 小窗同样应用正弦包络线，让两侧边缘自然收束
                        const envelope = 0.02 + 0.98 * Math.sin(Math.PI * (i / (pipVisualizerBars.length - 1)));
                        value = value * envelope;
                        
                        // 小窗空间较小，强度（intensity）设为 1.2，底线设为 0.05
                        const scale = 0.05 + value * 1.2; 
                        pipVisualizerBars[i].style.transform = `scaleY(${scale.toFixed(3)}) translateZ(0)`;
                    }
                }
            }

            // 避免重复启动导致帧率翻倍
            if (!visualizerRafId) {
                renderFrame();
            }
        }

        function stopAudioVisualizer() {
            lastVisualizerFrame = -Infinity;
            if (mobileVisualizer && bgmAudio.paused) mobileVisualizer.reset();
            if (visualizerRafId) {
                (visualizerRafWindow || window).cancelAnimationFrame(visualizerRafId);
                visualizerRafId = null;
                visualizerRafWindow = null;
            }
        }
        // 首次点播放时提前解锁安卓 AudioContext，避免异步获取地址后失去用户手势。
        function primeMobileAudioAnalyser() {
            if (!compactVisualizer || iosVisualizer || reducedVisualizerMotion.matches) return;
            ensureAudioAnalyser();
            if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(function () {});
        }
        reducedVisualizerMotion.addEventListener('change', function () {
            stopAudioVisualizer();
            if (!bgmAudio.paused) startAudioVisualizer();
        });
        let mobileVisualizerWaiting = false;
        function onVisualizerWaiting(event) {
            if (event.currentTarget === bgmAudio) mobileVisualizerWaiting = true;
        }
        function onVisualizerPlaying(event) {
            if (event.currentTarget !== bgmAudio) return;
            mobileVisualizerWaiting = false;
            startAudioVisualizer();
        }
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) savePlaybackSession(true);
            document.body.classList.toggle('is-background', document.hidden);
            stopAudioVisualizer();
            if (!bgmAudio.paused) {
                startAudioVisualizer();
                if (!document.hidden) updateProgressDisplay();
            }
        });
        window.addEventListener('pagehide', function () { savePlaybackSession(true); });
        let globalPreloadAudio = createPlayerAudio();
        let activeCachedAudioUrl = null;
        let playRequestVersion = 0;
        let cancelAudioCacheDownload = null;

        function releaseCachedAudioUrl() {
            if (activeCachedAudioUrl) URL.revokeObjectURL(activeCachedAudioUrl);
            activeCachedAudioUrl = null;
        }

        // --- 加载信息框 ---
        var loadingInfoEl = document.getElementById('loading-info');
        var loadingInfoTimer = null;      // setInterval 句柄，每秒刷新显示
        var loadingStartTime = null;      // 开始加载的时间戳
        var loadingBvid = null;           // 当前正在加载的 bvid

        // phase: 'resolve' | 'proxy' | 'buffering'
        function showLoadingInfo(bvid, phase) {
            loadingBvid = bvid;
            if (!loadingStartTime) loadingStartTime = Date.now();
            if (loadingInfoTimer) { clearInterval(loadingInfoTimer); loadingInfoTimer = null; }
            updateLoadingInfoContent(getSongNameByBvid(bvid), phase);
            if (loadingInfoEl) loadingInfoEl.classList.add('is-visible');
            // 只有 buffering 阶段需要定时刷新以更新 readyState 与等待秒数
            if (phase === 'buffering') {
                loadingInfoTimer = setInterval(function () {
                    if (!loadingBvid) { hideLoadingInfo(); return; }
                    updateLoadingInfoContent(getSongNameByBvid(loadingBvid), 'buffering');
                }, 100);
            }
            syncHomePlayer();
        }

        function updateLoadingInfoContent(songName, phase) {
            if (!loadingInfoEl) return;
            var elapsed = loadingStartTime ? ((Date.now() - loadingStartTime) / 1000).toFixed(1) : '0.0';
            var detail;
            if (phase === 'resolve') {
                detail = '已等待 ' + elapsed + ' 秒 · 获取音频ID中(1/6)';
            } else if (phase === 'proxy') {
                detail = '已等待 ' + elapsed + ' 秒 · 读取音频位置中(2/6)';
            } else {
                var stateMap = ['获取音频数据中(3/6)', '已获取元数据(4/6)', '有数据(5/6)', '可播放(6/6)', '可播放(6/6)'];
                var stateDesc = stateMap[bgmAudio.readyState] || '连接中';
                detail = '已等待 ' + elapsed + ' 秒 · ' + stateDesc;
            }
            if (!loadingInfoEl.querySelector('.loading-title')) {
                loadingInfoEl.innerHTML = '<div class="loading-title"></div><div class="loading-detail"></div>';
            }
            loadingInfoEl.querySelector('.loading-title').textContent = '歌曲《' + songName + '》加载中';
            loadingInfoEl.querySelector('.loading-detail').textContent = detail;
        }

        function hideLoadingInfo() {
            loadingBvid = null;
            loadingStartTime = null;
            if (loadingInfoTimer) { clearInterval(loadingInfoTimer); loadingInfoTimer = null; }
            if (loadingInfoEl) loadingInfoEl.classList.remove('is-visible');
            syncHomePlayer();
        }

        // 封装事件监听绑定逻辑，因为每次"偷梁换柱"后都需要重新绑定
        function bindAudioEvents(audioObj) {
            // 移除旧的监听器（虽然新对象没有监听器，但这是一个好习惯）
            audioObj.removeEventListener('timeupdate', updateProgressDisplay);
            audioObj.removeEventListener('loadedmetadata', updateProgressDisplay);
            audioObj.removeEventListener('ended', handleAudioEnded);
            audioObj.removeEventListener('play', handleAudioPlay);
            audioObj.removeEventListener('pause', handleAudioPause);
            audioObj.removeEventListener('error', handleAudioError);
            audioObj.removeEventListener('waiting', onVisualizerWaiting);
            audioObj.removeEventListener('playing', onVisualizerPlaying);

            audioObj.addEventListener('timeupdate', updateProgressDisplay);
            audioObj.addEventListener('loadedmetadata', updateProgressDisplay);
            audioObj.addEventListener('ended', handleAudioEnded);
            audioObj.addEventListener('play', handleAudioPlay);
            audioObj.addEventListener('pause', handleAudioPause);
            audioObj.addEventListener('error', handleAudioError);
            audioObj.addEventListener('waiting', onVisualizerWaiting);
            audioObj.addEventListener('playing', onVisualizerPlaying);
        }

        // 单独抽离 ended 处理函数，方便绑定
        function handleAudioEnded() {
            updateProgressDisplay();
            stopVisuals();
            updatePlayPauseIcon();
            if (typeof adjustMode !== 'undefined' && adjustMode) return;
            playNextByMode();
        }

        /** 外部控制播放/暂停（如控制中心、锁屏）时同步按钮与视觉效果 */
        function handleAudioPlay() {
            if (failedPlaybackBvid === currentPlayingBvid) clearPlaybackError();
            updatePlayPauseIcon();
            if (currentPlayingBvid) startVisuals(currentPlayingBvid);
            updateMediaSession();
        }
        function handleAudioPause() {
            savePlaybackSession(true);
            if (bulkCache) bulkCache.notify();
            updatePlayPauseIcon();
            stopVisuals();
            updateMediaSession();
        }

        function handleAudioError(event) {
            if (event.currentTarget !== bgmAudio || !currentPlayingBvid ||
                (loadingBvid && loadingBvid !== currentPlayingBvid)) return;
            if (bgmAudio.error && bgmAudio.error.code === 1) return;
            hideLoadingInfo();
            handlePlayError(currentPlayingBvid, new Error('音频暂时无法加载，可以重试或切换下一首。'));
            updatePlayPauseIcon();
        }

        // 初始化绑定
        bindAudioEvents(bgmAudio);
        
        const characterImg = document.querySelector('.character-img');

        // 默认进入首页视图，确保初始不会显示播放页的黑胶与控制条
        showView('home');

        // --- 预加载与 API 调用（在结束前一定时间尝试直链预加载）---
        const PRELOAD_AHEAD_SEC = 30;
        let preloadCache = null;
        let preloadInFlight = null;
        let preloadScheduledForBvid = null;
        let preloadGeneration = 0;
        let initialPreloadBvid = null;
        let initialPreloadForResume = false;

        /** 根据 bvid 取歌名（用于弹窗提示） */
        function getSongNameByBvid(bvid) {
            var s = getSongInfo(bvid);
            return s ? (s.name || s.title || bvid) : (bvid || '未知');
        }

        /** 页面内 Toast 提示，若干秒后自动消失，无需用户确认 */
        var toastTimer = null;
        function showToast(text, durationMs) {
            var el = document.getElementById('toast');
            if (!el) return;
            if (toastTimer) clearTimeout(toastTimer);
            el.textContent = text;
            el.classList.add('is-visible');
            toastTimer = setTimeout(function () {
                el.classList.remove('is-visible');
                toastTimer = null;
            }, durationMs || 3500);
        }

        function getCurrentAudioMode() {
            var m = (settings && settings.audioMode) || 'medium';
            if (['low', 'medium', 'high'].indexOf(m) < 0) m = 'medium';
            return m;
        }

        /** 兼容 resolvehtml 接口；错误交给调用方处理。 */
        function fetchResolveHtml(bvid) {
            return biliClient.resolve(bvid, getCurrentAudioMode(), true);
        }

        /**
         * 使用 resolve + proxy 的方式获取最终可播放地址：
         * 1) /resolve 拿到 B 站真实音频地址
         * 2) 前端通过 /proxy 转发该地址，避免直接命中 B 站 403
         * 返回 { url }（此 url 已经是 proxy 地址）
         */
        function fetchResolveViaProxy(bvid) {
            return biliClient.resolve(bvid, getCurrentAudioMode()).then(function (data) {
                const ua = navigator.userAgent || '';
                const appleWebKit = /AppleWebKit\//.test(ua) && !/(?:Chrome|Chromium|Edg|OPR|SamsungBrowser)\//.test(ua);
                const appleMobile = /iP(?:hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                const nativeHls = appleMobile && appleWebKit && typeof bgmAudio.canPlayType === 'function' && bgmAudio.canPlayType('application/vnd.apple.mpegurl');
                return { url: nativeHls && data.hlsUrl ? data.hlsUrl : data.proxyUrl };
            });
        }

        /** 返回预加载地址，或重新解析代理地址；接口错误交给播放流程展示。 */
        async function getLoadableRealUrl(bvid, initialUrl) {
            if (initialUrl) return initialUrl;
            var result = await fetchResolveViaProxy(bvid);
            return result.url;
        }

        /** 从元素的 computed transform 或 inline style 得到当前旋转角度（度） */
        function getRecordRotationDeg(el) {
            if (!el) return 0;
            const style = el.style.transform;
            if (style && style.includes('rotate')) {
                const m = style.match(/rotate\(([-\d.]+)deg\)/);
                if (m) return parseFloat(m[1]) || 0;
            }
            const computed = getComputedStyle(el).transform;
            if (!computed || computed === 'none') return 0;
            const parts = computed.replace(/^matrix\(|\)$/, '').split(',').map(s => parseFloat(s.trim()));
            if (parts.length >= 4) {
                const angle = Math.atan2(parts[1], parts[0]) * (180 / Math.PI);
                return angle;
            }
            return 0;
        }
        let playMode = 'list';        // 'list' | 'single' | 'random'
        let playScope = 'all';        // 'all' | 'favorites' | 'downloaded'

        const btnPlayPause = document.getElementById('btn-play-pause');
        const btnModeCycle = document.getElementById('btn-mode-cycle');
        const timeCurrentEl = document.getElementById('time-current');
        const timeTotalEl = document.getElementById('time-total');
        const progressBarEl = document.getElementById('progress-bar');
        const progressBarContainerEl = progressBarEl ? progressBarEl.closest('.progress-bar-container') : null;

        function formatTime(sec) {
            if (sec === undefined || sec === null || !isFinite(sec) || isNaN(sec)) return '0:00';
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            return m + ':' + (s < 10 ? '0' : '') + s;
        }

        function updateProgressDisplay() {
            applyResumePosition();
            savePlaybackSession(false);
            const t = bgmAudio.currentTime;
            let d = bgmAudio.duration;

            // 【救命药方】：拦截苹果浏览器获取不到总时长（Infinity）导致进度条归零的 Bug
            if (d === Infinity) {
                // 如果系统抽风返回 Infinity，我们临时用已播放时间撑起进度条，防止报错
                d = Math.max(t + 1, 200); 
            }

            // 核心业务（就算锁屏在后台也必须执行）：检查是否需要预加载下一首
            if (isFinite(d) && d > 0) {
                onTimeUpdateForPreload();
            }

            // 性能救星：如果浏览器切到后台，立刻停止后续的 UI 渲染，防止系统强杀！
            if (bulkCache) bulkCache.notify();
            if (document.hidden) return;
            syncHomePlayerProgress();

            // UI 更新逻辑（进度条视觉由 .progress-bar-container 的 --progress 控制，需同步更新容器）
            if (!isDraggingProgress) {
                if (timeCurrentEl) timeCurrentEl.textContent = formatTime(t);
                if (isFinite(d) && d > 0) {
                    if (timeTotalEl) timeTotalEl.textContent = formatTime(d);
                    const p = (t / d) * 100;
                    if (progressBarEl) {
                        progressBarEl.value = p;
                        progressBarEl.style.setProperty('--progress', p + '%');
                    }
                    if (progressBarContainerEl) progressBarContainerEl.style.setProperty('--progress', p + '%');
                } else {
                    if (timeTotalEl) timeTotalEl.textContent = '0:00';
                    if (progressBarEl) {
                        progressBarEl.value = 0;
                        progressBarEl.style.setProperty('--progress', '0%');
                    }
                    if (progressBarContainerEl) progressBarContainerEl.style.setProperty('--progress', '0%');
                }
            }
        }

        const MODE_TITLES = { list: '列表循环', single: '单曲循环', random: '随机播放' };
        const SCOPE_TITLES = { all: '全部歌曲', favorites: '我的收藏', downloaded: '已下载' };

        function invalidateNextPlayback() {
            // 首页尚未播放时保留已准备好的第一首。
            if (currentPlayingBvid) {
                clearPreload();
                stopInitialPreload();
            }
            preloadScheduledForBvid = null;
        }

        function syncPlaybackOptions() {
            const collectionName = typeof getPlaybackPlaylistName === 'function' ? getPlaybackPlaylistName() : '';
            const scopeName = collectionName ? collectionName + (playScope === 'all' ? '' : ' · ' + SCOPE_TITLES[playScope]) : SCOPE_TITLES[playScope];
            const summary = scopeName + ' · ' + MODE_TITLES[playMode];
            if (btnModeCycle) {
                btnModeCycle.classList.remove('is-mode-list', 'is-mode-single', 'is-mode-random', 'is-mode-favorites', 'is-mode-downloaded');
                btnModeCycle.classList.add('is-mode-' + playMode);
                btnModeCycle.title = summary;
                btnModeCycle.setAttribute('aria-label', summary + '，打开播放方式');
                const label = document.getElementById('play-mode-label');
                if (label) label.textContent = playScope === 'all' ? MODE_TITLES[playMode]
                    : ({ favorites: '收藏', downloaded: '下载' })[playScope] + '·' + ({ list: '循环', single: '单曲', random: '随机' })[playMode];
            }
            document.querySelectorAll('[data-play-scope]').forEach(function (button) {
                if (button.dataset.playScope === 'all') button.textContent = collectionName ? '当前歌单' : '全部歌曲';
                button.setAttribute('aria-pressed', String(button.dataset.playScope === playScope));
                button.disabled = button.dataset.playScope === 'favorites' && !getFavoritesList().length ||
                    button.dataset.playScope === 'downloaded' && !getDownloadedList().length;
                if (collectionName) {
                    const source = getCollectionSongs(playbackPlaylistId);
                    button.disabled = button.dataset.playScope === 'favorites' && !source.some(song => isFavorite(song.bvid)) ||
                        button.dataset.playScope === 'downloaded' && !source.some(song => cachedBvidsSet.has(song.bvid));
                }
            });
            document.querySelectorAll('[data-play-order]').forEach(function (button) {
                button.setAttribute('aria-pressed', String(button.dataset.playOrder === playMode));
            });
            const status = document.getElementById('playback-options-status');
            if (status) status.textContent = summary;
        }

        function setPlayMode(mode) {
            if (!['list', 'single', 'random'].includes(mode)) mode = 'list';
            if (playMode !== mode) invalidateNextPlayback();
            playMode = mode;
            syncPlaybackOptions();
            try { localStorage.setItem(PLAY_MODE_STORAGE_KEY, mode); } catch (_) {}
            savePlaybackSession(true);
        }

        function setPlayScope(scope) {
            if (!['all', 'favorites', 'downloaded'].includes(scope)) scope = 'all';
            if (scope === 'favorites' && !favoritesSet.size || scope === 'downloaded' && !cachedBvidsSet.size) scope = 'all';
            if (playScope !== scope) invalidateNextPlayback();
            playScope = scope;
            syncPlaybackOptions();
            try { localStorage.setItem(PLAY_SCOPE_STORAGE_KEY, scope); } catch (_) {}
            savePlaybackSession(true);
        }

        /** 收藏列表（保持 songList 顺序） */
        function getFavoritesList() {
            return songList.filter(s => isFavorite(s.bvid));
        }

        /** 已下载列表（保持 songList 顺序） */
        function getDownloadedList() {
            if (!cachedBvidsSet || !cachedBvidsSet.size) return [];
            return songList.filter(function (s) {
                return s.bvid && cachedBvidsSet.has(s.bvid || '');
            });
        }

        /** 当前模式下的可播列表 */
        function getEffectiveList() {
            if (typeof playbackPlaylistId !== 'undefined' && playbackPlaylistId && typeof getCollectionSongs === 'function') {
                const list = getCollectionSongs(playbackPlaylistId);
                return list.filter(song => playScope === 'favorites' ? isFavorite(song.bvid) : playScope === 'downloaded' ? cachedBvidsSet.has(song.bvid) : true);
            }
            if (playScope === 'favorites') return getFavoritesList();
            if (playScope === 'downloaded') return getDownloadedList();
            return songList;
        }

        /** 在当前模式列表中的下标，-1 表示不在列表中 */
        function getCurrentIndexInEffectiveList() {
            const list = getEffectiveList();
            if (!list.length || !currentPlayingBvid) return -1;
            return list.findIndex(s => (s.bvid || '') === currentPlayingBvid);
        }

        function getCurrentIndex() {
            if (!currentPlayingBvid || !songList.length) return -1;
            return songList.findIndex(s => (s.bvid || '') === currentPlayingBvid);
        }

        /** 在 [0, n) 内取随机索引；excludeIndex 若 >=0 则不选该索引（在其余 n-1 首里均匀随机） */
        function getRandomIndex(n, excludeIndex) {
            if (n <= 0) return 0;
            if (n === 1) return 0;
            const needExclude = excludeIndex >= 0 && excludeIndex < n && n > 1;
            const range = needExclude ? n - 1 : n;
            const useCrypto = typeof crypto !== 'undefined' && crypto.getRandomValues;
            let k;
            if (useCrypto) {
                const arr = new Uint32Array(1);
                crypto.getRandomValues(arr);
                k = arr[0] % range;
            } else {
                k = Math.floor(Math.random() * range);
            }
            if (needExclude) return k >= excludeIndex ? k + 1 : k;
            return k;
        }

        function getNextBvid() {
            const queued = getQueuedNext();
            if (queued) return queued.bvid;
            const list = playMode === 'random' ? getRandomList() : getEffectiveList();
            if (!list.length) return null;
            const anchor = listeningLibrary.anchor || currentPlayingBvid;
            if (playMode === 'single') return anchor && list.some(song => song.bvid === anchor) ? anchor : list[0].bvid;
            if (playMode === 'random') return randomQueue.peekNext(list.map(song => song.bvid), currentPlayingBvid);
            const index = list.findIndex(song => song.bvid === anchor);
            return list[index < 0 ? 0 : (index + 1) % list.length].bvid || null;
        }

        function clearPreload() {
            preloadGeneration++;
            preloadCache = null;
            preloadInFlight = null;
            initialPreloadBvid = null;
            initialPreloadForResume = false;
        }

        function getHomeRandomBvid() {
            // 首次随机已经在进入首页时抽好，点击时复用同一首，避免白做预加载。
            const prepared = !currentPlayingBvid && !initialPreloadForResume && initialPreloadBvid;
            if (prepared && !listeningLibrary.isExcluded(prepared) && songList.some(song => song.bvid === prepared)) return prepared;
            return randomQueue.peekNext(songList.filter(song => !listeningLibrary.isExcluded(song.bvid)).map(song => song.bvid), currentPlayingBvid) || '';
        }

        /** 首页进入时静默预加载一首歌（不播放、不展示），以便首次播放时提速；随机选一首 */
        function runInitialPreload() {
            if (songList.length === 0) return;
            if (currentPlayingBvid) return;
            if (playScope === 'downloaded') return;
            const candidates = songList.filter(song => !listeningLibrary.isExcluded(song.bvid));
            var idx = getRandomIndex(candidates.length, -1);
            initialPreloadForResume = !!(resumeSession && songList.some(song => song.bvid === resumeSession.bvid));
            var bvid = initialPreloadForResume ? resumeSession.bvid : (candidates[idx] && candidates[idx].bvid || '').trim();
            if (!bvid) return;
            initialPreloadBvid = bvid;
            const generation = preloadGeneration;
            fetchResolveViaProxy(bvid).then(function (result) {
                if (!result || !result.url) return;
                if (currentPlayingBvid || generation !== preloadGeneration) return;
                preloadCache = { bvid: bvid, url: result.url, createdAt: Date.now() };
                globalPreloadAudio.src = result.url;
                globalPreloadAudio.load();
            }).catch(function () {});
        }

        /** 停止初始预加载（进入播放页且播放的不是预加载曲目时调用，避免后台继续加载） */
        function stopInitialPreload() {
            if (!globalPreloadAudio) return;
            globalPreloadAudio.removeAttribute('src');
            globalPreloadAudio.load();
        }

        /**
         * 异步预取下一首的播放地址并缓存；
         * 使用 resolve + proxy，失败后不立即重试，避免放大上游风控。
         */
        function tryPreloadNext() {
            if (playScope === 'downloaded') return;
            const nextBvid = getNextBvid();
            if (!nextBvid || nextBvid === currentPlayingBvid) return;
            if (preloadCache && preloadCache.bvid === nextBvid && Date.now() - preloadCache.createdAt < 60000) return;
            if (preloadInFlight === nextBvid) return;
            preloadInFlight = nextBvid;
            (async function () {
                const result = await fetchResolveViaProxy(nextBvid);
                const url = result && result.url;
                if (url && preloadInFlight === nextBvid) {
                    preloadCache = { bvid: nextBvid, url: url, createdAt: Date.now() };
                    // var preloadAudio = new Audio();
                    // preloadAudio.preload = 'auto';
                    // preloadAudio.src = url;
                    
                    // 只加载，不播放
                    globalPreloadAudio.src = url;
                    globalPreloadAudio.load();
                }
            })().catch(function () {}).then(function () {
                if (preloadInFlight === nextBvid) preloadInFlight = null;
            });
        }

        /** 提前准备下一首，但优先保证当前歌曲的播放缓冲。 */
        function onTimeUpdateForPreload() {
            if (!window.SG_PLAYBACK_BUFFER.shouldPreload(bgmAudio, PRELOAD_AHEAD_SEC)) return;
            if (currentPlayingBvid === preloadScheduledForBvid) return;
            preloadScheduledForBvid = currentPlayingBvid;
            tryPreloadNext();
        }

        function playNextByMode() {
            const next = getNextBvid();
            if (!next) { if (playMode === 'random') showToast('没有可随机播放的歌曲，可在歌单的“已排除”中恢复。'); return; }
            const queued = getQueuedNext();
            if (!queued && playMode === 'single' && next === currentPlayingBvid && bgmAudio.src) {
                bgmAudio.currentTime = 0;
                togglePlayback();
                return;
            }
            playMusic(next, { direction: 'forward', queueEntryId: queued && queued.bvid === next ? queued.id : null });
        }

        function updatePlayPauseIcon() {
            if (btnPlayPause) {
                btnPlayPause.classList.toggle('is-playing', !bgmAudio.paused);
                btnPlayPause.title = bgmAudio.paused ? '播放' : '暂停';
                btnPlayPause.setAttribute('aria-label', bgmAudio.paused ? '播放' : '暂停');
            }
            syncHomePlayer();
            updateDocumentTitle();
        }

        function updatePlaySongName() {
            if (!playSongNameEl) return;
            playSongNameEl.textContent = currentPlayingBvid ? getSongNameByBvid(currentPlayingBvid) : '—';
            updateFavButton();
            updateDocumentTitle();
        }

        function updateDocumentTitle() {
            if (currentPlayingBvid && !bgmAudio.paused) {
                const name = getSongNameByBvid(currentPlayingBvid);
                document.title = name + ' · ' + CONFIG.titleSuffix;
            } else {
                document.title = DEFAULT_TITLE;
            }
        }

        /** 同步控制中心/锁屏的媒体会话：元数据、播放状态、以及 play/pause/上一首/下一首 的响应（iOS 暂停后点播放需由此恢复） */
        function updateMediaSession() {
            if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
            try {
                if ((settings && settings.mediaSession) === 'off') {
                    // 用户关闭媒体会话：清除元数据并注销所有 handler，让系统不感知此页面
                    navigator.mediaSession.metadata = null;
                    navigator.mediaSession.playbackState = 'none';
                    ['play', 'pause', 'previoustrack', 'nexttrack'].forEach(function (action) {
                        try { navigator.mediaSession.setActionHandler(action, null); } catch (e) {}
                    });
                    return;
                }
                navigator.mediaSession.playbackState = bgmAudio.paused ? 'paused' : 'playing';
                if (currentPlayingBvid) {
                    const name = getSongNameByBvid(currentPlayingBvid);
                    const useLockscreenLyric = (settings && settings.lockscreenLyric) === 'on';
                    const hasLyrics = typeof currentLyrics !== 'undefined' && currentLyrics && currentLyrics.length > 0;
                    const currentTxt = (hasLyrics && currentLyricIndex >= 0 && currentLyrics[currentLyricIndex])
                        ? (currentLyrics[currentLyricIndex].text || '') : '';
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: (useLockscreenLyric && hasLyrics) ? (currentTxt || name) : name,
                        artist: (useLockscreenLyric && hasLyrics) ? (name + ' · 思诺音乐') : '思诺音乐',
                        album: '',
                        artwork: window.SG_WARDROBE.artwork()
                    });
                }
                navigator.mediaSession.setActionHandler('play', function () {
                    if (bgmAudio.paused) togglePlayback();
                });
                navigator.mediaSession.setActionHandler('pause', function () {
                    bgmAudio.pause();
                });
                navigator.mediaSession.setActionHandler('previoustrack', function () { goPrev(); });
                navigator.mediaSession.setActionHandler('nexttrack', function () { goNext(); });
            } catch (e) { /* 部分环境不支持或 setActionHandler 不可用 */ }
        }

        // 原生 HLS / 普通音频播放，复用预加载并保留失败恢复。
        async function playMusic(bvid, options) {
            if (!bvid) return;
            if (adjustMode && adjustBvid !== bvid) {
                if (adjustSaving) { showToast('正在保存调轴，请稍候。'); return; }
                if (!confirm('正在调轴，是否不保存并切换歌曲？')) return;
                cancelAdjustMode();
            }
            primeMobileAudioAnalyser();
            mobileVisualizerWaiting = true;
            savePlaybackSession(true);
            clearPlaybackError();
            const requestVersion = ++playRequestVersion;
            pendingPlayback = { bvid: bvid, version: requestVersion, time: options && options.resumeTime || 0,
                direction: options && options.direction, queueEntryId: options && options.queueEntryId,
                queueAnchor: listeningLibrary.anchor || currentPlayingBvid,
                preserveQueueAnchor: options && options.preserveQueueAnchor,
                started: false, ready: false, positionApplied: false };
            if (bulkCache && bulkCache.isActive()) bulkCache.pause('切换歌曲，已暂停缓存；缓冲充足后可继续。');
            if (cancelAudioCacheDownload) {
                cancelAudioCacheDownload();
                cancelAudioCacheDownload = null;
            }

            preloadScheduledForBvid = null;
            if (!preloadCache || preloadCache.bvid !== bvid || Date.now() - preloadCache.createdAt >= 60000) {
                clearPreload();
                stopInitialPreload();
            }

            const useCache = !!(window.SG_CACHE && window.SG_CACHE.supported);

            // 若已开启缓存，优先尝试从 IndexedDB 读取缓存播放
            if (useCache && window.SG_CACHE && typeof window.SG_CACHE.getCachedBlob === 'function') {
                try {
                    const cachedBlob = await window.SG_CACHE.getCachedBlob(bvid);
                    if (requestVersion !== playRequestVersion) return;
                    if (cachedBlob) {
                        stopInitialPreload();
                        clearPreload();
                        currentPlayingBvid = bvid;

                        bgmAudio.pause();
                        releaseCachedAudioUrl();
                        activeCachedAudioUrl = URL.createObjectURL(cachedBlob);
                        bgmAudio.src = activeCachedAudioUrl;
                        bgmAudio.volume = 0.5;
                        sessionAudioBvid = bvid;
                        pendingPlayback.ready = true;

                        showLoadingInfo(bvid, 'buffering');
                        updateProgressDisplay();
                        updatePlaySongName();

                        try {
                            await bgmAudio.play();
                            if (requestVersion !== playRequestVersion) return;
                            rememberStartedPlayback();
                            hideLoadingInfo();
                            startVisuals(bvid);
                            updatePlayPauseIcon();
                            updateMediaSession();
                        } catch (errCache) {
                            if (requestVersion !== playRequestVersion) return;
                            hideLoadingInfo();
                            handlePlayError(bvid, errCache);
                            updatePlayPauseIcon();
                        }
                        return;
                    }
                } catch (e) { /* 缓存异常时回退到正常流程 */ }
            }

            if (playScope === 'downloaded') {
                hideLoadingInfo();
                handlePlayError(bvid, new Error('这首歌的本地缓存已不可用，请切换下一首，或改为全部歌曲后重试。'));
                return;
            }

            // 标记：是否使用了预加载对象
            let usePreloadObject = false;
            var initialUrl = null;

            if (preloadCache && preloadCache.bvid === bvid && Date.now() - preloadCache.createdAt < 60000) {
                initialUrl = preloadCache.url;
                preloadCache = null;
                usePreloadObject = true; // 命中缓存
            }
            clearPreload();

            // 等价于 getLoadableRealUrl(bvid, initialUrl)
            var realUrl;
            if (initialUrl) {
                // 命中预加载缓存，直接使用，无需走 resolve/proxy 阶段
                realUrl = initialUrl;
            } else {
                // 未命中：完整走 resolve → proxy 两阶段，并在每步更新信息框
                showLoadingInfo(bvid, 'resolve');
                var resolveRes;
                try {
                    resolveRes = await fetchResolveViaProxy(bvid);
                    if (requestVersion !== playRequestVersion) return;
                } catch (error) {
                    if (requestVersion !== playRequestVersion) return;
                    hideLoadingInfo();
                    handlePlayError(bvid, error);
                    return;
                }
                showLoadingInfo(bvid, 'proxy');
                realUrl = resolveRes.url;
            }

            if (!realUrl) {
                hideLoadingInfo();
                handlePlayError(bvid, 'NO_URL');
                return;
            }

            currentPlayingBvid = bvid;
            releaseCachedAudioUrl();

            if (usePreloadObject && realUrl === initialUrl) {
                bgmAudio.pause();
                let oldAudio = bgmAudio;
                bgmAudio = globalPreloadAudio;

                bindAudioEvents(bgmAudio);

                bgmAudio.volume = 0.5;

                globalPreloadAudio = createPlayerAudio();

                // 销毁旧对象前先移除其事件监听，否则清空 src 时可能触发 ended，导致多切一首
                oldAudio.removeEventListener('timeupdate', updateProgressDisplay);
                oldAudio.removeEventListener('loadedmetadata', updateProgressDisplay);
                oldAudio.removeEventListener('ended', handleAudioEnded);
                oldAudio.removeEventListener('play', handleAudioPlay);
                oldAudio.removeEventListener('pause', handleAudioPause);
                oldAudio.removeEventListener('error', handleAudioError);
                oldAudio.removeEventListener('waiting', onVisualizerWaiting);
                oldAudio.removeEventListener('playing', onVisualizerPlaying);
                oldAudio.removeAttribute('src');
                oldAudio.load();
                oldAudio.remove();
                oldAudio = null;
            } else {
                // 没命中预加载：停止初始预加载，避免后台继续加载
                stopInitialPreload();
                bgmAudio.src = realUrl;
                bgmAudio.volume = 0.5;
            }

            sessionAudioBvid = bvid;
            pendingPlayback.ready = true;
            showLoadingInfo(bvid, 'buffering');
            updateProgressDisplay();
            updatePlaySongName();

            try {
                await bgmAudio.play();
                if (requestVersion !== playRequestVersion) return;
                rememberStartedPlayback();
                clearPlaybackError();
                hideLoadingInfo();
            } catch (err) {
                if (requestVersion !== playRequestVersion) return;
                console.error("播放失败:", err);
                // 分段播放不兼容时回退普通音频；过期的预加载地址刷新一次。
                const directUrl = realUrl.replace('/hls.m3u8?', '/proxy?');
                if ((directUrl !== realUrl || realUrl === initialUrl) && err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
                    try {
                        realUrl = directUrl !== realUrl ? directUrl : await getLoadableRealUrl(bvid, null);
                        if (requestVersion !== playRequestVersion) return;
                        bgmAudio.src = realUrl;
                        pendingPlayback.positionApplied = false;
                        applyResumePosition();
                        await bgmAudio.play();
                        if (requestVersion !== playRequestVersion) return;
                        rememberStartedPlayback();
                        clearPlaybackError();
                        hideLoadingInfo();
                    } catch (retryError) {
                        if (requestVersion !== playRequestVersion) return;
                        err = retryError;
                        realUrl = null;
                    }
                } else {
                    realUrl = null;
                }
                if (!realUrl) {
                    hideLoadingInfo();
                    handlePlayError(bvid, err);
                    updatePlayPauseIcon();
                    return;
                }
            }

            // 缓冲充足或暂停时才下载离线缓存，缓冲不足时优先播放。
            if (useCache && settings.cacheEnabled === 'on' && window.SG_CACHE && window.SG_CACHE.supported &&
                typeof window.SG_CACHE.saveToCache === 'function' &&
                typeof window.SG_CACHE.getCachedBlob === 'function' && realUrl) {
                try {
                    const hasCache = typeof window.SG_CACHE.hasCached === 'function'
                        ? window.SG_CACHE.hasCached(bvid) : window.SG_CACHE.getCachedBlob(bvid);
                    hasCache.then(function (cached) {
                        if (cached || requestVersion !== playRequestVersion) return null;
                        cancelAudioCacheDownload = window.SG_PLAYBACK_BUFFER.cacheWhenBuffered({
                            audio: bgmAudio,
                            url: realUrl.replace('/hls.m3u8?', '/proxy?'),
                            isCurrent: function () { return requestVersion === playRequestVersion && settings.cacheEnabled === 'on' && (!bulkCache || !bulkCache.isActive()); },
                            save: function (blob) { return window.SG_CACHE.saveToCache(bvid, blob); },
                            onSaved: async function () {
                                if (await window.SG_CACHE.hasCached(bvid)) {
                                    cachedBvidsSet.add(bvid);
                                    updatePlayDownloadsButton();
                                    playlistRenderKey = '';
                                }
                            },
                        });
                    }).catch(function () { });
                } catch (e) { }
            }

            startVisuals(bvid);
            updatePlayPauseIcon();
            updateMediaSession();
        }

        function handlePlayError(bvid, errOrCode) {
            if (errOrCode && errOrCode.name === 'AbortError') return;
            failedPlaybackBvid = bvid;
            failedPlaybackKind = errOrCode && errOrCode.name === 'NotAllowedError' ? 'autoplay' : '';
            if (bvid === currentPlayingBvid || bgmAudio.paused) stopVisuals();
            const fallback = '歌曲暂时无法播放，可以重试、切换下一首，或前往 B 站查看。';
            const message = failedPlaybackKind === 'autoplay' ? '浏览器需要你手动确认播放，点击下方按钮即可继续。'
                : errOrCode && errOrCode.message && errOrCode.name === 'Error' ? errOrCode.message : fallback;
            if (!playbackRecoveryEl) { showToast(message, 6000); return; }
            document.getElementById('playback-recovery-song').textContent = getSongNameByBvid(bvid);
            document.getElementById('playback-recovery-message').textContent = message;
            document.getElementById('playback-retry').textContent = failedPlaybackKind === 'autoplay' ? '点击播放' : '重试';
            document.getElementById('playback-bilibili').href = 'https://www.bilibili.com/video/' + encodeURIComponent(bvid);
            const queuedNext = listeningLibrary.list('queue').some(song => song.bvid !== bvid && (playScope !== 'downloaded' || cachedBvidsSet.has(song.bvid)));
            const candidates = playMode === 'random' ? getRandomList() : getEffectiveList();
            document.getElementById('playback-next').disabled = !queuedNext && !candidates.some(song => song.bvid && song.bvid !== bvid);
            playbackRecoveryEl.hidden = false;
            syncHomePlayer();
        }

        // 视觉效果联动：暂停时保持当前角度，播放时从该角度继续转
        function startVisuals(bvid) {
            const deg = getRecordRotationDeg(characterImg);
            characterImg.style.setProperty('--start-deg', deg + 'deg');
            characterImg.style.removeProperty('transform');
            characterImg.classList.add('is-playing');
            startAudioVisualizer();
        }

        function stopVisuals() {
            const deg = getRecordRotationDeg(characterImg);
            characterImg.classList.remove('is-playing');
            characterImg.style.setProperty('transform', 'rotate(' + deg + 'deg)');
            stopAudioVisualizer();
            if (pipWindow && !bgmAudio.paused) startAudioVisualizer();
        }

        // 播放条与时间（timeupdate/loadedmetadata/ended 已由 bindAudioEvents 统一绑定，此处不再重复）

        // 拖动进度条跳转（完美修复移动端松手卡死问题）
        let isDraggingProgress = false;
        if (progressBarEl) {
            // 1. 手指按下时，锁定 UI 更新
            progressBarEl.addEventListener('touchstart', function() { isDraggingProgress = true; }, { passive: true });
            progressBarEl.addEventListener('mousedown', function() { isDraggingProgress = true; });

            // 2. 拖拽时只更新画面，绝不干扰音频解码器
            progressBarEl.addEventListener('input', function () {
                isDraggingProgress = true;
                const d = bgmAudio.duration;
                if (isFinite(d) && d > 0) {
                    const p = parseFloat(this.value);
                    this.style.setProperty('--progress', p + '%');
                    if (progressBarContainerEl) progressBarContainerEl.style.setProperty('--progress', p + '%');
                    if (timeCurrentEl) timeCurrentEl.textContent = formatTime((p / 100) * d);
                }
            });
            
            // 3. 核心：无论用户以什么姿势松手，都确保释放锁定并执行跳转
            function finishDrag() {
                if (!isDraggingProgress) return;
                isDraggingProgress = false;
                const d = bgmAudio.duration;
                if (isFinite(d) && d > 0) {
                    bgmAudio.currentTime = (parseFloat(progressBarEl.value) / 100) * d;
                }
            }

            progressBarEl.addEventListener('change', finishDrag);
            progressBarEl.addEventListener('touchend', finishDrag);
            progressBarEl.addEventListener('mouseup', finishDrag);
        }

        // 所有播放入口共用错误处理，避免恢复播放时出现未处理的异常。
        async function togglePlayback() {
            if (bgmAudio.paused) primeMobileAudioAnalyser();
            if (!currentPlayingBvid && resumeSession) return resumeLastPlayback();
            if (!bgmAudio.paused) {
                bgmAudio.pause();
                stopVisuals();
                updatePlayPauseIcon();
                return;
            }
            if (failedPlaybackBvid && failedPlaybackBvid === currentPlayingBvid) return retryPlayback();
            if (!bgmAudio.src) {
                if (songList.length) return playMusic(songList[0].bvid || '');
                return;
            }
            const bvid = currentPlayingBvid;
            const version = playRequestVersion;
            try {
                await bgmAudio.play();
                if (version !== playRequestVersion || bvid !== currentPlayingBvid) return;
                rememberStartedPlayback();
                updatePlayPauseIcon();
            } catch (error) {
                if (version === playRequestVersion && bvid === currentPlayingBvid) handlePlayError(bvid, error);
            }
        }
        btnPlayPause.addEventListener('click', togglePlayback);
        if (homePlayerToggleEl) homePlayerToggleEl.addEventListener('click', togglePlayback);
        const homePlayerOpenEl = document.getElementById('home-now-playing-open');
        if (homePlayerOpenEl) homePlayerOpenEl.addEventListener('click', function () {
            if (!currentPlayingBvid && resumeSession) { resumeLastPlayback(); return; }
            showView('play');
            if (currentPlayingBvid && !bgmAudio.paused) startVisuals(currentPlayingBvid);
            updateProgressDisplay();
        });
        const retryButton = document.getElementById('playback-retry');
        if (retryButton) retryButton.addEventListener('click', retryPlayback);
        const recoveryNextButton = document.getElementById('playback-next');
        if (recoveryNextButton) recoveryNextButton.addEventListener('click', playNextAfterFailure);
        const recoveryCloseButton = document.getElementById('playback-recovery-close');
        if (recoveryCloseButton) recoveryCloseButton.addEventListener('click', clearPlaybackError);

        const playbackOptionsDialog = document.getElementById('playback-options-dialog');
        if (btnModeCycle) btnModeCycle.addEventListener('click', function () {
            syncPlaybackOptions();
            if (!playbackOptionsDialog.open) playbackOptionsDialog.showModal();
        });
        document.querySelectorAll('[data-play-scope]').forEach(function (button) {
            button.addEventListener('click', function () { setPlayScope(button.dataset.playScope); });
        });
        document.querySelectorAll('[data-play-order]').forEach(function (button) {
            button.addEventListener('click', function () { setPlayMode(button.dataset.playOrder); });
        });
        document.getElementById('playback-options-close').addEventListener('click', function () { playbackOptionsDialog.close(); });
        playbackOptionsDialog.addEventListener('click', function (event) {
            if (event.target !== playbackOptionsDialog) return;
            const bounds = playbackOptionsDialog.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) playbackOptionsDialog.close();
        });
        (function initPlayMode() {
            let order = 'list', scope = 'all';
            try {
                const saved = localStorage.getItem(PLAY_MODE_STORAGE_KEY) || 'list';
                order = ['list', 'single', 'random'].includes(saved) ? saved : 'list';
                scope = localStorage.getItem(PLAY_SCOPE_STORAGE_KEY) || (['favorites', 'downloaded'].includes(saved) ? saved : 'all');
            } catch (_) {}
            // 已下载列表由 IndexedDB 异步读取，读取完成后再校正范围。
            playScope = ['all', 'favorites', 'downloaded'].includes(scope) ? scope : 'all';
            if (playScope === 'favorites' && !favoritesSet.size || playScope === 'downloaded' && (!window.SG_CACHE || !window.SG_CACHE.supported)) playScope = 'all';
            try { localStorage.setItem(PLAY_SCOPE_STORAGE_KEY, playScope); } catch (_) {}
            setPlayMode(order);
        })();
        updatePlayPauseIcon();

        // 初始化版本小红点提示
        initVersionIndicators();

        // 收藏按钮（下一曲与歌单之间）：切换当前曲收藏状态
        const btnFav = document.getElementById('btn-fav');
        function updateFavButton() {
            if (!btnFav) return;
            btnFav.classList.toggle('is-fav', isFavorite(currentPlayingBvid));
            btnFav.title = isFavorite(currentPlayingBvid) ? '取消收藏' : '收藏';
            btnFav.setAttribute('aria-label', isFavorite(currentPlayingBvid) ? '取消收藏当前歌曲' : '收藏当前歌曲');
            btnFav.setAttribute('aria-pressed', String(isFavorite(currentPlayingBvid)));
        }
        if (btnFav) {
            btnFav.addEventListener('click', () => {
                if (!currentPlayingBvid) return;
                toggleFavorite(currentPlayingBvid);
                updateFavButton();
                if (playlistFilterBtn) {
                    playlistFilterBtn.classList.toggle('active', playlistFilterFavorites);
                    if (playlistFilterFavorites) renderPlaylist();
                }
            });
        }

        // 上一首 / 下一首
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        function goPrev() {
            const list = getEffectiveList();
            if (!list.length) return;
            if (playMode === 'random') {
                const previous = randomQueue.peekPrevious(list.map(song => song.bvid));
                if (previous) playMusic(previous, { direction: 'back' });
                else showToast('还没有更早的播放记录。');
            } else {
                const index = getCurrentIndexInEffectiveList();
                playMusic(list[index <= 0 ? list.length - 1 : index - 1].bvid || '');
            }
        }
        function goNext() {
            const queued = getQueuedNext();
            if (queued) { playMusic(queued.bvid, { direction: 'forward', queueEntryId: queued.id }); return; }
            const list = getEffectiveList();
            if (!list.length) return;
            // 手动下一首在单曲循环时仍然切到下一首。
            const index = list.findIndex(song => song.bvid === (listeningLibrary.anchor || currentPlayingBvid));
            const next = playMode === 'random' ? getNextBvid() : list[index < 0 ? 0 : (index + 1) % list.length].bvid;
            if (next) playMusic(next, { direction: 'forward' });
            else showToast('没有可随机播放的歌曲，可在歌单的“已排除”中恢复。');
        }
        if (btnPrev) btnPrev.addEventListener('click', goPrev);
        if (btnNext) btnNext.addEventListener('click', goNext);

        // 点击唱片与底部播放按钮使用相同的恢复逻辑。
        characterImg.addEventListener('click', function () {
            if (viewPlay.classList.contains('is-active')) togglePlayback();
        });

        // 尽早注册控制中心/锁屏的 play/pause/上一首/下一首，避免 iOS 暂停后点播放无响应
        updateMediaSession();

        // ── Picture-in-Picture 小窗播放 ──────────────────────────────
        const btnPip = document.getElementById('btn-pip');

        // 按设置 + 浏览器支持情况决定按钮可见性
        syncPipSettingButtons();
        syncLockscreenLyricButtons();
        syncCacheButtons();

        function getSongName() {
            const idx = getCurrentIndex();
            if (idx >= 0 && songList[idx]) return songList[idx].name || songList[idx].title || '—';
            return currentPlayingBvid ? '…' : '—';
        }

        function buildPipHTML() {
            return '<div class="pip-player">' +
                '<div class="pip-song-name" id="pip-song-name"></div>' +
                '<div class="pip-lyric" id="pip-lyric"></div>' +
                '<div class="pip-progress-wrap">' +
                    '<span class="pip-time" id="pip-time-current">0:00</span>' +
                    '<input type="range" class="pip-bar" id="pip-bar" min="0" max="100" value="0" step="0.1">' +
                    '<span class="pip-time" id="pip-time-total">0:00</span>' +
                '</div>' +
                '<div class="pip-controls">' +
                    '<button type="button" class="pip-btn pip-mode btn-mode-cycle is-mode-list" title="播放模式" id="pip-mode-btn">' +
                        '<svg class="icon-mode icon-mode-list" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 1l4 4-4 4-1.4-1.4 1.6-1.6H5v6H3V4h14.2l-1.6-1.6L17 1zm-10 22l-4-4 4-4 1.4 1.4-1.6 1.6H19v-6h2v8H6.8l1.6 1.6L7 23z" /></svg>' +
                        '<svg class="icon-mode icon-mode-single" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 1l4 4-4 4-1.4-1.4 1.6-1.6H5v6H3V4h14.2l-1.6-1.6L17 1zm-10 22l-4-4 4-4 1.4 1.4-1.6 1.6H19v-6h2v8H6.8l1.6 1.6L7 23z" /><path d="M10.7 9.3L12.1 7.7L12 8v7.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>' +
                        '<svg class="icon-mode icon-mode-random" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.7 14.2C8 14.7 7.1 15 6.2 15H4c-0.6 0-1 0.4-1 1s0.4 1 1 1h2.2c1.3 0 2.6-0.4 3.7-1.2c0.4-0.3 0.5-1 0.2-1.4C9.7 13.9 9.1 13.8 8.7 14.2z" /><path d="M13 10.7c0.3 0 0.6-0.1 0.8-0.3C14.5 9.5 15.6 9 16.8 9h0.8l-0.3 0.3c-0.4 0.4-0.4 1 0 1.4c0.2 0.2 0.5 0.3 0.7 0.3s0.5-0.1 0.7-0.3l2-2c0.1-0.1 0.2-0.2 0.2-0.3c0.1-0.2 0.1-0.5 0-0.8c-0.1-0.1-0.1-0.2-0.2-0.3l-2-2c-0.4-0.4-1-0.4-1.4 0s-0.4 1 0 1.4L17.6 7h-0.8c-1.8 0-3.4 0.8-4.6 2.1c-0.4 0.4-0.3 1 0.1 1.4C12.5 10.7 12.8 10.7 13 10.7z" /><path d="M20.7 15.3l-2-2c-0.4-0.4-1-0.4-1.4 0s-0.4 1 0 1.4l0.3 0.3h-1.5c-1.6 0-2.9-0.9-3.6-2.3l-1.2-2.4C10.3 8.3 8.2 7 5.9 7H4C3.4 7 3 7.4 3 8s0.4 1 1 1h1.9c1.6 0 2.9 0.9 3.6 2.3l1.2 2.4c1 2.1 3.1 3.4 5.4 3.4h1.5l-0.3 0.3c-0.4 0.4-0.4 1 0 1.4c0.2 0.2 0.5 0.3 0.7 0.3s0.5-0.1 0.7-0.3l2-2C21.1 16.3 21.1 15.7 20.7 15.3z" /></svg>' +
                        '<svg class="icon-mode icon-mode-favorites" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 1l4 4-4 4-1.4-1.4 1.6-1.6H5v6H3V4h14.2l-1.6-1.6L17 1zm-10 22l-4-4 4-4 1.4 1.4-1.6 1.6H19v-6h2v8H6.8l1.6 1.6L7 23z" /><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" transform="translate(12,12) scale(0.32) translate(-12,-12)" /></svg>' +
                        '<svg class="icon-mode icon-mode-downloaded" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 1l4 4-4 4-1.4-1.4 1.6-1.6H5v6H3V4h14.2l-1.6-1.6L17 1zm-10 22l-4-4 4-4 1.4 1.4-1.6 1.6H19v-6h2v8H6.8l1.6 1.6L7 23z" fill="currentColor" stroke="none" /><polyline points="8 12 11 15 16 10" fill="none" stroke="currentColor" stroke-width="2" /></svg>' +
                    '</button>' +
                    '<button type="button" class="pip-btn pip-prev" title="上一首">' +
                        '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6V6zm4.5 6 8.5 6V6l-8.5 6z"/></svg>' +
                    '</button>' +
                    '<button type="button" class="pip-btn pip-play" title="播放/暂停">' +
                        '<svg class="icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5z"/></svg>' +
                        '<svg class="icon-pause" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' +
                    '</button>' +
                    '<button type="button" class="pip-btn pip-next" title="下一首">' +
                        '<svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2V6zM5 6v12l8.5-6L5 6z"/></svg>' +
                    '</button>' +
                    '<button type="button" class="pip-btn pip-fav" title="收藏" id="pip-fav-btn">' +
                        '<svg class="icon-star-outline" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
                        '<svg class="icon-star-filled" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
                    '</button>' +
                '</div>' +
                '<div class="pip-visualizer" id="pip-visualizer"></div>' +
            '</div>';
        }

        function syncPipUI() {
            if (!pipWindow) return;
            const pd = pipWindow.document;
            const nameEl = pd.getElementById('pip-song-name');
            const lyricEl = pd.getElementById('pip-lyric');
            const curEl = pd.getElementById('pip-time-current');
            const totEl = pd.getElementById('pip-time-total');
            const barEl = pd.getElementById('pip-bar');
            const playBtn = pd.querySelector('.pip-play');
            const pipFavBtn = pd.getElementById('pip-fav-btn');
            const pipModeBtn = pd.getElementById('pip-mode-btn');

            if (nameEl) nameEl.textContent = getSongName();
            if (lyricEl) {
                var lyricTxt = (currentLyrics && currentLyricIndex >= 0 && currentLyrics[currentLyricIndex])
                    ? (currentLyrics[currentLyricIndex].text || '') : '';
                lyricEl.textContent = lyricTxt;
            }
            if (playBtn) playBtn.classList.toggle('is-playing', !bgmAudio.paused);
            if (pipFavBtn) {
                const isFav = isFavorite(currentPlayingBvid);
                pipFavBtn.classList.toggle('is-fav', isFav);
                pipFavBtn.title = isFav ? '取消收藏' : '收藏';
            }

            // 同步播放模式图标：复用主播放页的 is-mode-* 语义
            if (pipModeBtn) {
                pipModeBtn.classList.remove('is-mode-list', 'is-mode-single', 'is-mode-random', 'is-mode-favorites', 'is-mode-downloaded');
                if (playMode === 'single') pipModeBtn.classList.add('is-mode-single');
                else if (playMode === 'random') pipModeBtn.classList.add('is-mode-random');
                else if (playMode === 'favorites') pipModeBtn.classList.add('is-mode-favorites');
                else if (playMode === 'downloaded') pipModeBtn.classList.add('is-mode-downloaded');
                else pipModeBtn.classList.add('is-mode-list');
            }

            // 同步进度到小窗进度条，并驱动 --progress 变量控制已播长度
            const t = bgmAudio.currentTime;
            const d = bgmAudio.duration;
            if (curEl) curEl.textContent = formatTime(t);
            if (isFinite(d) && d > 0) {
                if (totEl) totEl.textContent = formatTime(d);
                if (barEl) {
                    const p = (t / d) * 100;
                    barEl.value = p;
                    barEl.style.setProperty('--progress', p + '%');
                }
            } else {
                if (totEl) totEl.textContent = '0:00';
                if (barEl) { barEl.value = 0; barEl.style.setProperty('--progress', '0%'); }
            }
        }

        async function openPip() {
            if (pipWindow) { pipWindow.close(); return; }
            try {
                pipWindow = await documentPictureInPicture.requestWindow({ width: 320, height: 175 });

                // 复制主文档 CSS 到小窗
                [...document.styleSheets].forEach(function (ss) {
                    try {
                        var cssText = [...ss.cssRules].map(function (r) { return r.cssText; }).join('');
                        var style = pipWindow.document.createElement('style');
                        style.textContent = cssText;
                        pipWindow.document.head.appendChild(style);
                    } catch (e) {
                        if (ss.href) {
                            var link = pipWindow.document.createElement('link');
                            link.rel = 'stylesheet'; link.href = ss.href;
                            pipWindow.document.head.appendChild(link);
                        }
                    }
                });

                // 写入播放器 HTML
                pipWindow.document.body.innerHTML = buildPipHTML();
                pipWindow.document.body.style.cssText = 'margin:0;padding:0;height:100vh;overflow:hidden;background:#000;';

                // 【修复3】：为避免样式复制异常，单独注入小窗频谱专属的 GPU 加速 CSS
                var pipStyle = pipWindow.document.createElement('style');
                pipStyle.textContent = `
                    .pip-visualizer {
                        position: absolute; /* 绝对沉底 */
                        bottom: 0;
                        left: 0;
                        width: 100%;
                        height: 28px;
                        display: flex;
                        align-items: flex-end;
                        justify-content: space-between;
                        opacity: 0.18; /* 还原主页的高级灰色透明度 */
                        pointer-events: none;
                        padding: 0 16px;
                        box-sizing: border-box;
                    }
                    .pip-visualizer .bar {
                        width: 3px;
                        margin: 0 1px;
                        height: 100%;
                        background-color: #000;
                        border-radius: 3px 3px 0 0;
                        transform-origin: bottom;
                        transform: scaleY(0.05) translateZ(0); 
                        will-change: transform;
                    }
                `;
                pipWindow.document.head.appendChild(pipStyle);

                // 初始化小窗频谱：根据小窗实际宽度动态生成柱子数量
                var pipVisEl = pipWindow.document.getElementById('pip-visualizer');
                if (pipVisEl) {
                    pipVisualizerEl = pipVisEl;
                    pipVisualizerEl.innerHTML = '';
                    pipVisualizerBars = [];
                    // 小窗宽度一般为 320px，柱宽3+间距2=5，算出大约 64 根
                    var barCount = Math.floor(pipWindow.innerWidth / 5) || 64; 
                    var frag = pipWindow.document.createDocumentFragment();
                    for (var i = 0; i < barCount; i++) {
                        var bar = pipWindow.document.createElement('div');
                        bar.className = 'bar';
                        frag.appendChild(bar);
                        pipVisualizerBars.push(bar);
                    }
                    pipVisualizerEl.appendChild(frag);
                }

                // 绑定按钮事件
                pipWindow.document.querySelector('.pip-prev').addEventListener('click', goPrev);
                pipWindow.document.querySelector('.pip-next').addEventListener('click', goNext);
                pipWindow.document.querySelector('.pip-play').addEventListener('click', togglePlayback);
                // 播放模式循环按钮
                var pipModeBtn = pipWindow.document.getElementById('pip-mode-btn');
                if (pipModeBtn && btnModeCycle) {
                    pipModeBtn.addEventListener('click', function () {
                        btnModeCycle.click();
                    });
                }
                // 收藏按钮
                var pipFavBtn = pipWindow.document.getElementById('pip-fav-btn');
                if (pipFavBtn) {
                    pipFavBtn.addEventListener('click', function () {
                        if (!currentPlayingBvid) return;
                        toggleFavorite(currentPlayingBvid);
                        updateFavButton();
                        syncPipUI();
                    });
                }
                var pipBarEl = pipWindow.document.getElementById('pip-bar');
                if (pipBarEl) {
                    pipBarEl.addEventListener('input', function () {
                        var d = bgmAudio.duration;
                        if (isFinite(d) && d > 0) {
                            bgmAudio.currentTime = (this.value / 100) * d;
                            this.style.setProperty('--progress', this.value + '%');
                        }
                    });
                }

                // 小窗关闭时清理
                pipWindow.addEventListener('pagehide', function () {
                    stopAudioVisualizer();
                    pipWindow = null;
                    pipVisualizerEl = null;
                    pipVisualizerBars = [];
                    if (btnPip) btnPip.classList.remove('is-pip-open');
                    if (!bgmAudio.paused) startAudioVisualizer();
                });

                if (btnPip) btnPip.classList.add('is-pip-open');
                syncPipUI();

                // 【强制激活引擎】：如果在后台开启小窗，确保渲染循环启动
                if (!bgmAudio.paused) {
                    stopAudioVisualizer();
                    startAudioVisualizer();
                }

                // 定时同步进度
                var pipSyncInterval = pipWindow.setInterval(syncPipUI, 500);
                pipWindow.addEventListener('pagehide', function () { pipWindow && pipWindow.clearInterval && pipWindow.clearInterval(pipSyncInterval); });
            } catch (e) {
                console.warn('PiP failed:', e);
                pipWindow = null;
            }
        }

        if (btnPip) btnPip.addEventListener('click', openPip);

        // 歌曲切换或播放状态变化时同步小窗
        var _origUpdatePlaySongName = updatePlaySongName;
        updatePlaySongName = function () { _origUpdatePlaySongName(); syncPipUI(); };
        var _origUpdatePlayPauseIcon = updatePlayPauseIcon;
        updatePlayPauseIcon = function () { _origUpdatePlayPauseIcon(); syncPipUI(); };

        // ── 歌词功能 ──────────────────────────────────────────────────
        var currentLyrics = null;       // [{time, text}] 或 null
        var currentLyricIndex = -1;     // 当前高亮行
        var lyricLineElements = [];
        var activeLyricElement = null;
        var lyricsLoadVersion = 0;
        var lyricsViewOpen = false;     // 是否处于歌词全屏视图
        var userHasLyric = false;       // 当前曲目是否有用户自定义歌词

        var availableFallbackLrc = null; // 【新增】：用于暂存探测到的同名歌词文本

        // 调轴模式状态
        var adjustMode = false;         // 是否处于调轴模式
        var adjustLyrics = null;        // 调轴中的歌词副本 [{time, text}]
        var adjustBvid = '';            // 调轴对应的 bvid
        var adjustRows = [];
        var activeAdjustRow = null;
        var adjustHighlightIndex = -2;
        var adjustOriginalLyrics = null;
        var adjustShiftBase = null;
        var adjustShiftSeconds = 0;
        var adjustSaving = false;

        var btnLyrics = document.getElementById('btn-lyrics');
        var lyricsViewEl = document.getElementById('lyrics-view');
        var lyricsScrollEl = document.getElementById('lyrics-scroll');
        var playCurrentLyricEl = document.getElementById('play-current-lyric');
        var lyricsSongNameBar = null; // 动态创建
        var lyricsFirstScrollDone = false; // 歌词自动滚动：是否已经做过一次「居中对齐」

        // 用户手动滚动歌词时暂停自动跟随
        var userScrollingLyrics = false;
        var userScrollingTimer = null;
        (function initLyricsScrollWatch() {
            if (!lyricsScrollEl) return;
            function onUserScroll() {
                userScrollingLyrics = true;
                clearTimeout(userScrollingTimer);
                userScrollingTimer = setTimeout(function () {
                    userScrollingLyrics = false;
                }, 2000);
            }
            lyricsScrollEl.addEventListener('wheel', onUserScroll, { passive: true });
            lyricsScrollEl.addEventListener('touchmove', onUserScroll, { passive: true });
        })();

        // 创建歌词模式下的歌名 bar

        /** 切换歌词全屏视图 */
        function toggleLyricsView(forceOpen) {
            lyricsViewOpen = forceOpen !== undefined ? forceOpen : !lyricsViewOpen;
            viewPlay.classList.toggle('is-lyrics-open', lyricsViewOpen);
            if (btnLyrics) {
                btnLyrics.classList.toggle('is-lyrics-open', lyricsViewOpen);
                btnLyrics.setAttribute('aria-pressed', String(lyricsViewOpen));
                btnLyrics.setAttribute('aria-label', lyricsViewOpen ? '返回唱片' : '显示歌词');
                btnLyrics.title = lyricsViewOpen ? '返回唱片' : '显示歌词';
            }
            // 歌词模式下：保留唱片可见，仅根据需要禁用交互
            var charLayer = document.querySelector('.character-layer');
            if (charLayer) {
                charLayer.style.opacity = '';
                charLayer.style.pointerEvents = lyricsViewOpen ? 'none' : '';
            }
            if (lyricsViewOpen) {
                lyricsFirstScrollDone = false; // 每次进入歌词模式重新计算第一次滚动
                if (adjustMode) renderAdjustScroll();
                else renderLyricsScroll();
            }
        }

        /** 将 [{time, text}] 转换为 LRC 文本 */
        function lyricsToLrcText(lines) {
            return lines.filter(function (l) { return l.text; }).map(function (l) {
                return '[' + formatLrcTime(l.time) + '] ' + l.text;
            }).join('\n');
        }

        /** 导出当前歌词为 LRC 文件 */
        function exportCurrentLyrics() {
            if (!currentLyrics || !currentLyrics.length) return;
            var idx = getCurrentIndex();
            var songName = (idx >= 0 && songList[idx]) ? (songList[idx].name || songList[idx].title || 'lyrics') : 'lyrics';
            var lrcText = lyricsToLrcText(currentLyrics);
            var blob = new Blob([lrcText], { type: 'text/plain;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = songName + '.lrc';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('歌词已导出。');
        }

        /** 渲染歌词滚动区域 */
        function renderLyricsScroll() {
            if (adjustMode) { renderAdjustScroll(); return; }
            if (!lyricsScrollEl) return;
            lyricsScrollEl.innerHTML = '';
            lyricLineElements = [];
            activeLyricElement = null;

            // 找到 renderLyricsScroll 里的空状态处理部分
            if (!currentLyrics || currentLyrics.length === 0) {
                var emptyDiv = document.createElement('div');
                emptyDiv.className = 'lyrics-empty';
                
                var emptyText = document.createElement('div');
                emptyText.className = 'lyrics-empty-text';
                emptyText.textContent = availableFallbackLrc ? '暂无歌词，但我们找到了同名文件。' : '暂无歌词，小伙伴可自行添加 LRC 格式歌词。';
                emptyDiv.appendChild(emptyText);

                // 【核心新增：渲染同名歌词提示和载入按钮】
                if (availableFallbackLrc) {
                    var hintText = document.createElement('div');
                    hintText.style.fontSize = '0.85rem';
                    hintText.style.color = 'var(--text-main)';
                    hintText.style.fontWeight = '600';
                    hintText.style.marginTop = '-12px';
                    hintText.innerHTML = '✨ 歌词库中检索到同名 LRC 文件';
                    emptyDiv.appendChild(hintText);

                    var loadBtn = document.createElement('button');
                    loadBtn.type = 'button';
                    loadBtn.className = 'btn-add-lyric';
                    loadBtn.style.background = 'var(--neon-blue)';
                    loadBtn.style.color = '#000';
                    loadBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
                        </svg>
                        载入同名歌词
                    `;
                    loadBtn.addEventListener('click', function () {
                        if (!currentPlayingBvid) return;
                        window.SG_LYRICS.saveUserLrc(currentPlayingBvid, availableFallbackLrc).then(function() {
                            showToast('同名歌词已载入，可在此基础上修改或调轴。');
                            lyricsReloadForCurrentSong(); // 重新走一遍加载流程，就会显示正常歌词了！
                        });
                    });
                    emptyDiv.appendChild(loadBtn);
                }

                if (window.SG_LYRICS && window.SG_LYRICS.supported) {
                    var addBtn = document.createElement('button');
                    addBtn.type = 'button';
                    addBtn.className = 'btn-add-lyric';
                    
                    // 如果有自动载入按钮，就把手动添加按钮降级为弱视觉效果
                    if (availableFallbackLrc) {
                        addBtn.style.background = 'transparent';
                        addBtn.style.color = 'var(--text-sub)';
                        addBtn.style.border = '1px solid rgba(0,0,0,0.1)';
                        addBtn.style.boxShadow = 'none';
                        addBtn.innerHTML = `手动添加空白歌词`;
                    } else {
                        addBtn.innerHTML = `
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                            添加歌词
                        `;
                    }
                    
                    addBtn.addEventListener('click', function () {
                        openLyricForm(currentPlayingBvid || '', '');
                    });
                    emptyDiv.appendChild(addBtn);
                }
                lyricsScrollEl.appendChild(emptyDiv);
                return;
            }

            // 渲染歌词行
            var lyricsFragment = document.createDocumentFragment();
            currentLyrics.forEach(function (line, idx) {
                if (!line.text) return; // 跳过空行
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'lyric-line' + (idx === currentLyricIndex ? ' active' : '');
                btn.dataset.idx = idx;
                btn.textContent = line.text;
                lyricLineElements[idx] = btn;
                if (idx === currentLyricIndex) activeLyricElement = btn;
                btn.addEventListener('click', function () {
                    var t = currentLyrics[idx].time;
                    if (isFinite(bgmAudio.duration) && bgmAudio.duration > 0) {
                        bgmAudio.currentTime = t;
                        // 重置索引，确保 updateLyricHighlight 一定执行 DOM 高亮刷新
                        currentLyricIndex = -1;
                        updateProgressDisplay();
                    }
                });
                lyricsFragment.appendChild(btn);
            });
            lyricsScrollEl.appendChild(lyricsFragment);

            // 滚动到当前行
            scrollToActiveLyric(false);
        }

        /** 根据当前播放时间更新高亮歌词行 */
        function findLyricIndex(lines, time) {
            var low = 0, high = lines.length;
            while (low < high) {
                var mid = (low + high) >>> 1;
                if (lines[mid].time <= time) low = mid + 1;
                else high = mid;
            }
            return low - 1;
        }

        function updateLyricHighlight() {
            if (!currentLyrics || !currentLyrics.length) return;
            var t = bgmAudio.currentTime;
            var newIdx = findLyricIndex(currentLyrics, t);
            // 更新单行提示
            var txt = (newIdx >= 0 && currentLyrics[newIdx].text) ? currentLyrics[newIdx].text : '';
            if (playCurrentLyricEl && playCurrentLyricEl.textContent !== txt) {
                playCurrentLyricEl.textContent = txt;
            }
            if (newIdx === currentLyricIndex) return;
            currentLyricIndex = newIdx;

            // 同步 PiP 小窗歌词
            if (pipWindow) {
                var pipLyricEl = pipWindow.document.getElementById('pip-lyric');
                if (pipLyricEl) pipLyricEl.textContent = txt;
            }

            // 装扮与歌曲独立，媒体信息不将当前装扮误标为演唱者。
            if ((settings && settings.lockscreenLyric) === 'on' &&
                typeof navigator !== 'undefined' && navigator.mediaSession && navigator.mediaSession.metadata) {
                try {
                    var meta = navigator.mediaSession.metadata;
                    var idx2 = getCurrentIndex();
                    var songName2 = (idx2 >= 0 && songList[idx2]) ? (songList[idx2].name || songList[idx2].title || '—') : '—';
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: txt || songName2,
                        artist: songName2 + ' · 思诺音乐',
                        album: meta.album,
                        artwork: meta.artwork
                    });
                } catch (e) {}
            }

            if (!lyricsViewOpen) return;

            // 更新高亮（用 dataset.idx 匹配，避免空行跳过导致的 DOM 索引偏移）
            if (activeLyricElement) activeLyricElement.classList.remove('active');
            activeLyricElement = lyricLineElements[newIdx] || null;
            if (activeLyricElement) activeLyricElement.classList.add('active');
            // 调轴模式下不自动滚动
            if (!adjustMode) scrollToActiveLyric(true);
        }

        /** 将当前高亮行滚动到视图中央（略偏上，让视觉中心更舒服） */
        function scrollToActiveLyric(smooth) {
            if (!lyricsScrollEl || currentLyricIndex < 0) return;
            // 用户正在手动滚动时不自动跟随
            if (smooth && userScrollingLyrics) return;
            var active = lyricLineElements[currentLyricIndex];
            if (!active) return;
            var containerH = lyricsScrollEl.clientHeight;
            var targetTop;
            // 需求：第一句歌词刚开始时顶在容器最上方，其后高亮行始终保持在中间
            if (!lyricsFirstScrollDone && currentLyricIndex === 0) {
                targetTop = 0;
            } else {
                // 为了考虑顶部/底部虚化与 padding，让“居中”的视觉效果略微偏上：
                // 使用 0.45 而不是 0.5，约等于把高亮行放在容器高度的 45% 位置
                var centerRatio = 0.4;
                targetTop = active.offsetTop - containerH * centerRatio + active.clientHeight / 2;
            }
            lyricsFirstScrollDone = true;
            lyricsScrollEl.scrollTo({ top: targetTop, behavior: smooth ? 'smooth' : 'auto' });
        }

        /** 为当前歌曲加载并刷新歌词 (Async 优化版) */
        async function lyricsReloadForCurrentSong() {
            const bvid = currentPlayingBvid;
            const loadVersion = ++lyricsLoadVersion;
            // 1. 初始化状态
            currentLyrics = null;
            currentLyricIndex = -1;
            lyricsFirstScrollDone = false;
            userHasLyric = false;
            availableFallbackLrc = null;
            if (playCurrentLyricEl) playCurrentLyricEl.textContent = '';

            const btnManage = document.getElementById('btn-lyric-manage-toggle');
            const menu = document.getElementById('lyric-manage-menu');

            // 2. 基础检查
            if (!currentPlayingBvid || !window.SG_LYRICS) {
                if (btnManage) btnManage.style.display = 'none';
                if (menu) menu.classList.remove('is-open');
                if (lyricsViewOpen) renderLyricsScroll();
                return;
            }

            try {
                // 3. 顺序执行异步操作
                const userLrc = await window.SG_LYRICS.getUserLrc(bvid);
                if (loadVersion !== lyricsLoadVersion || bvid !== currentPlayingBvid) return;
                userHasLyric = !!userLrc;

                const lines = await window.SG_LYRICS.loadLyrics(bvid, userLrc);
                if (loadVersion !== lyricsLoadVersion || bvid !== currentPlayingBvid) return;
                currentLyrics = (lines && lines.length) ? lines : null;

                // 【新增逻辑：如果没找到绑定的歌词，去服务器盲猜同名 LRC 文件】
                if (!currentLyrics) {
                    var sName = getSongNameByBvid(bvid);
                    if (sName && sName !== '—' && sName !== '…') {
                        try {
                            var basePath = CONFIG.lyricsBasePath || './lyrics/';
                            var fbRes = await fetch(basePath + encodeURIComponent(sName) + '.lrc');
                            if (fbRes.ok) {
                                const text = await fbRes.text();
                                if (loadVersion !== lyricsLoadVersion || bvid !== currentPlayingBvid) return;
                                availableFallbackLrc = text;
                            }
                        } catch (err) {}
                    }
                }

                if (loadVersion !== lyricsLoadVersion || bvid !== currentPlayingBvid) return;
                // 4. 根据结果同步更新 UI
                if (btnManage) {
                    btnManage.style.display = (currentLyrics && currentLyrics.length > 0) ? 'inline-flex' : 'none';
                }
                
                // 【核心修改】：控制悬浮菜单中的导出和删除按钮，仅在有自定义歌词时显示
                const menuExport = document.getElementById('menu-lyric-export');
                const menuDelete = document.getElementById('menu-lyric-delete');
                if (menuExport) menuExport.style.display = userHasLyric ? 'flex' : 'none';
                if (menuDelete) menuDelete.style.display = userHasLyric ? 'flex' : 'none';

                // 切歌时确保关闭菜单
                if (menu) menu.classList.remove('is-open');

            } catch (e) {
                if (loadVersion !== lyricsLoadVersion || bvid !== currentPlayingBvid) return;
                console.error("歌词加载异常:", e);
                currentLyrics = null;
                if (btnManage) btnManage.style.display = 'none';
            }

            // 5. 如果正在歌词页面，刷新滚动区域
            if (lyricsViewOpen) renderLyricsScroll();
        }

        // 2. 初始化菜单事件绑定
        (function initLyricManageMenu() {
            const btnToggle = document.getElementById('btn-lyric-manage-toggle');
            const menu = document.getElementById('lyric-manage-menu');
            if (!btnToggle || !menu) return;

            // 切换菜单显隐
            btnToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.toggle('is-open');
            });

            // 2. 【关键修复】：点击菜单内部时，阻止事件冒泡到 document
            // 这样点击“删除歌词”时，菜单就不会因为触发全局关闭逻辑而消失了
            menu.addEventListener('click', (e) => {
                e.stopPropagation(); 
            });

            // 点击页面其他地方关闭菜单
            document.addEventListener('click', () => menu.classList.remove('is-open'));

            // 功能绑定
            document.getElementById('menu-lyric-edit').onclick = () => {
                menu.classList.remove('is-open'); // 【修复】点击后关闭菜单
                openLyricForm(currentPlayingBvid, '');
            };

            document.getElementById('menu-lyric-adjust').onclick = () => {
                menu.classList.remove('is-open'); // 【修复】点击后关闭菜单
                // 如果歌词视图没开，先强行打开
                if (!lyricsViewOpen) toggleLyricsView(true);
                enterAdjustMode();
            };

            document.getElementById('menu-lyric-export').onclick = () => {
                menu.classList.remove('is-open'); // 【修复】点击后关闭菜单
                exportCurrentLyrics();
            };

            document.getElementById('menu-lyric-delete').onclick = function() {
                const span = this.querySelector('span');
                if (span.textContent === '删除歌词') {
                    span.textContent = '确定删除？';
                    setTimeout(() => { span.textContent = '删除歌词'; }, 3000);
                } else {
                    window.SG_LYRICS.deleteUserLrc(currentPlayingBvid).then(() => {
                        // 【明确反馈】：告诉你删掉后回退到了系统原版
                        showToast('自定义歌词已删除，已恢复系统默认版本'); 
                        span.textContent = '删除歌词'; // 立即重置按钮文案
                        lyricsReloadForCurrentSong(); // 重新加载（触发第一步的逻辑，隐藏按钮）
                    });
                }
            };
        })();

        // ── 简易调轴功能 ──────────────────────────────────────────────

        /** 渲染调轴模式下的歌词列表（带悬浮操作栏） */
        function renderAdjustScroll() {
            if (!lyricsScrollEl || !adjustLyrics) return;
            lyricsScrollEl.innerHTML = '';
            adjustRows = [];
            activeAdjustRow = null;
            adjustHighlightIndex = -2;

            // 清理可能遗留的悬浮栏
            const existingBar = document.getElementById('adjust-action-bar');
            if (existingBar) existingBar.remove();

            // 1. 顶部提示说明 (带 Icon)
            var hintEl = document.createElement('div');
            hintEl.className = 'adjust-hint';
            hintEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> 播放到对应歌词时，点击该行对齐';
            lyricsScrollEl.appendChild(hintEl);

            const shiftControls = document.createElement('div');
            shiftControls.className = 'lyric-shift-controls';
            shiftControls.setAttribute('role', 'group');
            shiftControls.setAttribute('aria-label', '整首歌词微调');
            shiftControls.innerHTML = '<button type="button" data-lyric-shift="-0.5">提前 0.5 秒</button>' +
                '<button type="button" data-lyric-shift="0.5">延后 0.5 秒</button>' +
                '<button type="button" id="lyric-shift-reset" aria-label="重置本次调整" title="恢复进入调轴时的时间">重置</button>' +
                '<span class="lyric-shift-status" id="lyric-shift-status" role="status">整首微调 · 保存后生效</span>';
            shiftControls.querySelectorAll('[data-lyric-shift]').forEach(function (button) {
                button.addEventListener('click', function () { shiftAdjustLyrics(Number(button.dataset.lyricShift)); });
            });
            shiftControls.querySelector('#lyric-shift-reset').addEventListener('click', resetAdjustLyrics);
            lyricsScrollEl.appendChild(shiftControls);

            // 2. 渲染时间轴列表
            adjustLyrics.forEach(function (line, idx) {
                if (!line.text) return;
                var row = document.createElement('div');
                row.className = 'adjust-lyric-row';
                row.dataset.idx = idx;
                adjustRows[idx] = row;

                var timeEl = document.createElement('span');
                timeEl.className = 'adjust-lyric-time';
                timeEl.textContent = formatLrcTime(line.time);

                var textEl = document.createElement('span');
                textEl.className = 'adjust-lyric-text';
                textEl.textContent = line.text;

                row.appendChild(timeEl);
                row.appendChild(textEl);

                row.addEventListener('click', function () {
                    applyAdjustTime(idx);
                });

                lyricsScrollEl.appendChild(row);
            });

            // 3. 底部留白垫片：防止最后几行歌词被悬浮的底部操作栏挡住
            var spacer = document.createElement('div');
            spacer.style.height = '80px';
            lyricsScrollEl.appendChild(spacer);

            // 4. 创建底部悬浮操作栏 (挂载到外层 lyricsViewEl，使其绝对定位在歌词容器底部)
            var actionBar = document.createElement('div');
            actionBar.id = 'adjust-action-bar';
            actionBar.className = 'adjust-action-bar';

            // 【修改点】：先创建并添加“保存”按钮，让它排在左侧
            var saveAdjBtn = document.createElement('button');
            saveAdjBtn.type = 'button';
            saveAdjBtn.className = 'btn-adjust-action btn-adjust-save';
            saveAdjBtn.textContent = '保存调轴';
            saveAdjBtn.addEventListener('click', saveAdjustMode);
            actionBar.appendChild(saveAdjBtn);

            // 后创建并添加“取消”按钮，让它排在右侧
            var cancelAdjBtn = document.createElement('button');
            cancelAdjBtn.type = 'button';
            cancelAdjBtn.className = 'btn-adjust-action btn-adjust-cancel';
            cancelAdjBtn.textContent = '取消调轴';
            cancelAdjBtn.addEventListener('click', cancelAdjustMode);
            actionBar.appendChild(cancelAdjBtn);

            lyricsViewEl.appendChild(actionBar);

            // 初始化高亮
            updateAdjustHighlight();
        }

        /** 格式化秒数为 LRC 时间格式 MM:SS.cs */
        function formatLrcTime(t) {
            var total = Math.max(0, Math.round(t * 100));
            var min = Math.floor(total / 6000);
            var sec = Math.floor(total / 100) % 60;
            var cs = total % 100;
            return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
        }

        /** 更新调轴模式下的高亮行（跟随播放进度） */
        function updateAdjustHighlight() {
            if (!adjustMode || !adjustLyrics || !lyricsScrollEl) return;
            var t = bgmAudio.currentTime;
            var newIdx = findLyricIndex(adjustLyrics, t);
            if (newIdx === adjustHighlightIndex) return;
            adjustHighlightIndex = newIdx;
            if (activeAdjustRow) activeAdjustRow.classList.remove('is-current');
            activeAdjustRow = adjustRows[newIdx] || null;
            if (activeAdjustRow) activeAdjustRow.classList.add('is-current');
        }

        /** 对指定歌词行应用当前进度时间，后续行同步偏移 */
        function applyAdjustTime(idx) {
            if (!adjustLyrics || adjustSaving) return;
            var newTime = bgmAudio.currentTime;

            // 不得超过上一句（可等于）
            if (idx > 0 && newTime < adjustLyrics[idx - 1].time) {
                showToast('调整时间早于上句歌词，请先调整上句。');
                return;
            }

            var delta = newTime - adjustLyrics[idx].time;
            // 同步后续歌词时间
            for (var i = idx; i < adjustLyrics.length; i++) {
                adjustLyrics[i] = { time: Math.max(0, adjustLyrics[i].time + delta), text: adjustLyrics[i].text };
            }

            // 刷新时间显示
            var rows = lyricsScrollEl.querySelectorAll('.adjust-lyric-row');
            rows.forEach(function (row) {
                var ri = parseInt(row.dataset.idx);
                if (ri >= idx) {
                    var timeEl = row.querySelector('.adjust-lyric-time');
                    if (timeEl) timeEl.textContent = formatLrcTime(adjustLyrics[ri].time);
                }
            });

            showToast('已设置第 ' + (idx + 1) + ' 行时间。');
            adjustShiftBase = adjustLyrics.map(line => ({ time: line.time, text: line.text }));
            adjustShiftSeconds = 0;
            document.getElementById('lyric-shift-status').textContent = '逐句调整后，可继续整首微调 · 保存后生效';
        }

        function refreshAdjustTimes() {
            lyricsScrollEl.querySelectorAll('.adjust-lyric-row').forEach(function (row) {
                row.querySelector('.adjust-lyric-time').textContent = formatLrcTime(adjustLyrics[Number(row.dataset.idx)].time);
            });
            adjustHighlightIndex = -2;
            updateAdjustHighlight();
        }

        function shiftAdjustLyrics(seconds) {
            if (!adjustMode || !adjustShiftBase || adjustSaving) return;
            adjustShiftSeconds = Math.round((adjustShiftSeconds + seconds) * 10) / 10;
            // 每次从基准计算，提前到 0 秒后再延后也不会丢失原时间。
            adjustLyrics = window.SG_PLAYBACK_STATE.shiftLyrics(adjustShiftBase, adjustShiftSeconds);
            refreshAdjustTimes();
            document.getElementById('lyric-shift-status').textContent = (adjustShiftSeconds === 0 ? '未偏移' :
                '整首' + (adjustShiftSeconds < 0 ? '提前 ' : '延后 ') + Math.abs(adjustShiftSeconds).toFixed(1) + ' 秒') + ' · 保存后生效';
        }

        function resetAdjustLyrics() {
            if (!adjustMode || !adjustOriginalLyrics || adjustSaving) return;
            adjustLyrics = window.SG_PLAYBACK_STATE.shiftLyrics(adjustOriginalLyrics, 0);
            adjustShiftBase = window.SG_PLAYBACK_STATE.shiftLyrics(adjustOriginalLyrics, 0);
            adjustShiftSeconds = 0;
            refreshAdjustTimes();
            document.getElementById('lyric-shift-status').textContent = '已恢复进入调轴时的时间 · 保存后生效';
        }

        /** 进入调轴模式 */
        function enterAdjustMode() {
            if (adjustMode) return;
            if (!currentLyrics || !currentLyrics.length) {
                showToast('当前无歌词，无法调轴。');
                return;
            }
            if (!window.SG_LYRICS || !window.SG_LYRICS.supported) {
                showToast('当前浏览器不支持 IndexedDB，无法保存调轴结果。');
                return;
            }
            adjustMode = true;
            adjustBvid = currentPlayingBvid || '';
            // 深拷贝歌词
            adjustLyrics = currentLyrics.map(function (l) { return { time: l.time, text: l.text }; });
            adjustOriginalLyrics = window.SG_PLAYBACK_STATE.shiftLyrics(currentLyrics, 0);
            adjustShiftBase = window.SG_PLAYBACK_STATE.shiftLyrics(currentLyrics, 0);
            adjustShiftSeconds = 0;
            renderAdjustScroll();
        }

        /** 保存调轴结果 */
        function saveAdjustMode() {
            if (adjustSaving) return;
            if (!adjustLyrics || !adjustBvid) { cancelAdjustMode(); return; }
            var lrcText = lyricsToLrcText(adjustLyrics);
            adjustSaving = true;
            lyricsViewEl.querySelectorAll('.lyric-shift-controls button, .btn-adjust-action').forEach(button => { button.disabled = true; });
            window.SG_LYRICS.saveUserLrc(adjustBvid, lrcText).then(function () {
                adjustSaving = false;
                showToast('调轴已保存生效。');
                
                // 清理状态与悬浮栏
                adjustMode = false;
                adjustLyrics = null;
                adjustBvid = '';
                const bar = document.getElementById('adjust-action-bar');
                if (bar) bar.remove();
                
                // 重新加载并渲染常规歌词
                lyricsReloadForCurrentSong();
            }).catch(function () {
                adjustSaving = false;
                lyricsViewEl.querySelectorAll('.lyric-shift-controls button, .btn-adjust-action').forEach(button => { button.disabled = false; });
                showToast('保存失败，请重试。');
            });
        }

        /** 取消调轴模式 */
        function cancelAdjustMode() {
            if (adjustSaving) return;
            adjustMode = false;
            adjustLyrics = null;
            adjustBvid = '';
            
            // 清除悬浮操作栏
            const bar = document.getElementById('adjust-action-bar');
            if (bar) bar.remove();
            
            // 恢复常规歌词渲染
            renderLyricsScroll();
        }

        // 歌词进度同步钩入 timeupdate
        var _origUpdateProgressDisplay = updateProgressDisplay;
        updateProgressDisplay = function () {
            _origUpdateProgressDisplay();
            if (adjustMode) {
                updateAdjustHighlight();
            } else {
                updateLyricHighlight();
            }
        };

        // 歌曲切换时重新加载歌词（调轴中切歌才询问）
        var _origUpdatePlaySongNameForLyrics = updatePlaySongName;
        updatePlaySongName = function () {
            var prevBvid = adjustBvid;
            _origUpdatePlaySongNameForLyrics();
            // 调轴的退出确认在切歌前完成，避免旧歌词关联到新歌曲。
            if (adjustMode && currentPlayingBvid !== prevBvid) cancelAdjustMode();
            if (!adjustMode) lyricsReloadForCurrentSong();
            if (lyricsSongNameBar) {
                var idx = getCurrentIndex();
                lyricsSongNameBar.textContent = (idx >= 0 && songList[idx]) ? (songList[idx].name || songList[idx].title || '—') : '—';
            }
        };

        // 歌词按钮点击
        if (btnLyrics) {
            btnLyrics.addEventListener('click', function () {
                toggleLyricsView();
            });
        }

        // 离开播放页时关闭歌词视图
        var _origShowView = showView;
        showView = function (which) {
            _origShowView(which);
            if (which !== 'play' && lyricsViewOpen) {
                toggleLyricsView(false);
            }
        };

        // ── 歌词弹层（添加/编辑）──────────────────────────────────────
        var lyricFormVersion = 0;
        var lyricFormEdited = false;
        var lyricSearch = window.SG_LYRIC_SEARCH.create({
            getText: function () { return document.getElementById('lyric-form-textarea').value; },
            onApply: function (lrc) {
                var textarea = document.getElementById('lyric-form-textarea');
                textarea.value = lrc;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            },
            onApplied: function (timed) {
                showToast(timed ? '已填入歌词，保存后可继续调轴。' : '已填入纯文本歌词，保存后请逐句调轴。', 4500);
                document.getElementById('lyric-form-textarea').focus();
            },
        });
        /** 打开歌词编辑表单并预加载内容 */
        async function openLyricForm(bvid, songName) {
            if (!window.SG_LYRICS || !window.SG_LYRICS.supported) {
                showToast('当前浏览器不支持 IndexedDB，无法编辑歌词。');
                return;
            }

            var backdrop = document.getElementById('lyric-form-backdrop');
            var titleEl = document.getElementById('lyric-form-title');
            var bvidSubEl = document.getElementById('lyric-form-bvid');
            var textarea = document.getElementById('lyric-form-textarea');
            if (!backdrop || !textarea) return;

            // 自动补全歌名
            if (!songName && bvid) {
                const s = songList.find(x => (x.bvid || '').toUpperCase() === bvid.toUpperCase());
                if (s) songName = s.name || s.title;
            }
            if (titleEl) titleEl.textContent = '歌词 · ' + (songName || '未知曲目');
            if (bvidSubEl) bvidSubEl.textContent = bvid || '';
            var current = ++lyricFormVersion;
            lyricFormEdited = false;
            lyricSearch.reset(songName);
            function canPrefill() { return current === lyricFormVersion && !lyricFormEdited; }

            // 开启弹窗与加载提示
            textarea.value = '';
            textarea.placeholder = '正在获取歌词文本...';
            backdrop.dataset.bvid = bvid || '';
            backdrop.classList.add('is-open');
            setTimeout(function () {
                if (canPrefill() && document.getElementById('lyric-search-panel').hidden) textarea.focus();
            }, 100);

            try {
                // 1. 优先尝试从本地数据库获取用户修改过的歌词
                let finalLrc = await window.SG_LYRICS.getUserLrc(bvid);
                if (!canPrefill()) return;

                // 2. 最干净的逻辑：如果用户没存过，直接顺藤摸瓜去服务器拉取原始 LRC 文件！
                if (!finalLrc) {
                    try {
                        // 使用各站点配置的歌词目录，沿用浏览器缓存。
                        var basePath = CONFIG.lyricsBasePath || './lyrics/';
                        const indexRes = await fetch(basePath + 'lyrics.json');
                        if (indexRes.ok) {
                            const indexData = await indexRes.json();
                            const filename = indexData.map && indexData.map[bvid];
                            
                            // 如果在花名册里找到了，直接拉取该文件的纯文本
                            if (filename) {
                                const lrcRes = await fetch(basePath + encodeURIComponent(filename));
                                if (lrcRes.ok) {
                                    finalLrc = await lrcRes.text();
                                }
                            }
                        }
                    } catch (err) {
                        console.warn('获取系统原版歌词文本失败:', err);
                    }
                }

                // 3. 将最原汁原味的歌词填入输入框
                if (!canPrefill()) return;
                if (finalLrc) {
                    textarea.value = finalLrc;
                } else {
                    textarea.placeholder = '[00:00.00] 暂无系统歌词，请在此输入或导入...';
                }
            } catch (e) {
                console.error("加载歌词失败:", e);
                if (canPrefill()) textarea.placeholder = '加载失败，请重试或直接粘贴。';
            }
        }

        function closeLyricForm() {
            lyricFormVersion++;
            lyricSearch.close();
            var backdrop = document.getElementById('lyric-form-backdrop');
            if (backdrop) backdrop.classList.remove('is-open');
        }

        /** 提交保存歌词，包含正则校验、防抖加载与热更新 */
        async function submitLyricForm() {
            const backdrop = document.getElementById('lyric-form-backdrop');
            const textarea = document.getElementById('lyric-form-textarea');
            const btnSubmit = document.getElementById('lyric-form-submit');
            
            if (!backdrop || !textarea) return;

            const bvid = backdrop.dataset.bvid || '';
            const lrcText = (textarea.value || '').trim();
            const originalText = btnSubmit ? btnSubmit.textContent : '保存';

            if (!bvid) { closeLyricForm(); return; }

            try {
                // 【新版融合】：按钮状态变为加载中，防止重复点击
                if (btnSubmit) {
                    btnSubmit.textContent = '保存中...';
                    btnSubmit.classList.add('is-loading');
                }

                if (!lrcText) {
                    // 【原版融合】：空内容 = 删除，保留 confirm 二次确认
                    if (!confirm('歌词内容为空，是否删除该歌曲的自定义歌词？')) return;
                    await window.SG_LYRICS.deleteUserLrc(bvid);
                    showToast('自定义歌词已删除，恢复系统默认。');
                } else {
                    // 【原版融合】：简单的 LRC 格式强制校验
                    if (!/\[\d{1,3}:\d{2}/.test(lrcText)) {
                        showToast('格式有误，LRC 歌词需包含时间标签，如 [00:05.00]');
                        return; // return 会进入 finally 恢复按钮状态
                    }
                    
                    // 保存到用户的本地 IndexedDB
                    await window.SG_LYRICS.saveUserLrc(bvid, lrcText);
                    showToast('歌词已保存。');
                }

                // 关闭表单弹窗
                closeLyricForm();

                // 【核心热更新】：如果刚才改的正好是现在正在播放的歌，立刻生效！
                if (currentPlayingBvid && currentPlayingBvid.toUpperCase() === bvid.toUpperCase()) {
                    await lyricsReloadForCurrentSong(); 
                }

                // 【原版融合】：刷新后台管理列表中的歌词按钮状态
                const listEl = document.getElementById('custom-manage-list');
                if (listEl) {
                    const searchEl = document.getElementById('custom-manage-search');
                    renderCustomManageList(searchEl ? searchEl.value : '');
                }

            } catch (e) {
                console.error('保存歌词失败:', e);
                showToast('保存失败，请检查浏览器存储权限。');
            } finally {
                // 【新版融合】：无论成功失败或被正则拦截，强制恢复按钮状态
                if (btnSubmit) {
                    btnSubmit.textContent = originalText;
                    btnSubmit.classList.remove('is-loading');
                }
            }
        }

        (function initLyricForm() {
            var backdrop = document.getElementById('lyric-form-backdrop');
            var box = document.getElementById('lyric-form-box');
            var btnCancel = document.getElementById('lyric-form-cancel');
            var btnSubmit = document.getElementById('lyric-form-submit');
            var btnImport = document.getElementById('lyric-form-import-btn');
            var fileInput = document.getElementById('lyric-form-file-input');
            if (!backdrop) return;
            if (btnCancel) btnCancel.addEventListener('click', closeLyricForm);
            if (btnSubmit) btnSubmit.addEventListener('click', submitLyricForm);
            backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeLyricForm(); });
            if (box) box.addEventListener('click', function (e) { e.stopPropagation(); });
            document.getElementById('lyric-form-textarea').addEventListener('input', function () { lyricFormEdited = true; });
            // 文件导入
            if (btnImport && fileInput) {
                btnImport.addEventListener('click', function () { fileInput.click(); });
                fileInput.addEventListener('change', function () {
                    var file = this.files && this.files[0];
                    if (!file) return;
                    lyricFormEdited = true;
                    var current = lyricFormVersion;
                    var initialText = document.getElementById('lyric-form-textarea').value;
                    var reader = new FileReader();
                    reader.onload = function (e) {
                        var textarea = document.getElementById('lyric-form-textarea');
                        if (textarea && current === lyricFormVersion && textarea.value === initialText) {
                            textarea.value = e.target.result || '';
                            textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    };
                    reader.readAsText(file, 'UTF-8');
                    this.value = '';
                });
            }
        })();

        // 歌词模块完成所有 patch 后，重新绑定 audio 事件，
        // 确保 timeupdate 触发的是包含歌词高亮的最新 updateProgressDisplay
        bindAudioEvents(bgmAudio);

        function favoriteSongsForCache() {
            const known = [...mainList, ...liveList, ...customList, ...listeningLibrary.list('recent'), ...listeningLibrary.list('queue')];
            const seen = new Set();
            return known.filter(song => song.bvid && isFavorite(song.bvid) && !seen.has(song.bvid) && seen.add(song.bvid))
                .map(song => ({ bvid: song.bvid, name: song.name || song.title || song.bvid }));
        }

        function renderBulkCache() {
            const start = document.getElementById('bulk-cache-start');
            if (!start) return;
            const supported = !!(window.SG_CACHE && window.SG_CACHE.supported);
            const snapshot = bulkCache ? bulkCache.snapshot() : { state: 'idle', total: 0, done: 0, failed: 0, items: [] };
            start.disabled = !supported || !favoriteSongsForCache().length;
            start.hidden = ['running', 'paused'].includes(snapshot.state) && snapshot.total > 0;
            document.getElementById('bulk-cache-pause').hidden = snapshot.state !== 'running';
            document.getElementById('bulk-cache-resume').hidden = snapshot.state !== 'paused' || !snapshot.items.some(item => item.status === 'pending');
            document.getElementById('bulk-cache-retry').hidden = !snapshot.failed || snapshot.state === 'running';
            document.getElementById('bulk-cache-cancel').hidden = !snapshot.total;
            const status = document.getElementById('bulk-cache-status');
            status.textContent = !supported ? '当前浏览器不支持音频缓存。' : snapshot.total ?
                '已缓存 ' + snapshot.done + ' / ' + snapshot.total + ' 首' + (snapshot.failed ? ' · 失败 ' + snapshot.failed + ' 首' : '') +
                (snapshot.message ? '。' + snapshot.message : snapshot.state === 'complete' ? '。任务已完成。' : '') : '将收藏歌曲一次准备好，已缓存的歌曲会自动跳过。';
            const progress = document.getElementById('bulk-cache-progress');
            progress.hidden = !snapshot.total; progress.max = Math.max(1, snapshot.total); progress.value = snapshot.done + snapshot.failed;
            const failures = document.getElementById('bulk-cache-failures');
            failures.hidden = !snapshot.failed;
            document.getElementById('bulk-cache-failure-count').textContent = '查看失败歌曲（' + snapshot.failed + '）';
            const list = document.getElementById('bulk-cache-failure-list');
            const fragment = document.createDocumentFragment();
            snapshot.items.filter(item => item.status === 'failed').forEach(function (item) {
                const row = document.createElement('li'); row.textContent = item.name + '：' + item.error; fragment.appendChild(row);
            });
            list.replaceChildren(fragment);
            const marker = snapshot.state + ':' + snapshot.done + ':' + snapshot.failed;
            if (snapshot.total && snapshot.state === 'complete' && marker !== lastBulkCacheStatus) refreshStorageUsageDisplay();
            lastBulkCacheStatus = marker;
        }

        let lastBulkCacheStatus = '';
        (function initListeningTools() {
            document.querySelectorAll('[data-library-tab]').forEach(function (button) {
                button.addEventListener('click', function () {
                    playlistTab = button.dataset.libraryTab;
                    if (playlistTab === 'songs') browsedPlaylistId = '';
                    if (playlistSearchEl) playlistSearchEl.value = '';
                    playlistRenderKey = ''; syncLibraryTabs(); renderPlaylist();
                    playlistListEl.scrollTop = 0;
                });
            });
            document.getElementById('library-clear').addEventListener('click', function () {
                if (playlistTab === 'queue') { listeningLibrary.clearQueue(); invalidateNextPlayback(); }
                else if (playlistTab === 'recent') {
                    if (confirm('清空最近播放记录？')) listeningLibrary.clearRecent();
                }
            });
            const actions = document.getElementById('song-actions-dialog');
            document.getElementById('song-actions-close').addEventListener('click', () => actions.close());
            actions.addEventListener('click', function (event) {
                const button = event.target.closest('[data-song-action]');
                if (button) changeSongAction(button.dataset.songAction);
                else if (event.target === actions) {
                    const bounds = actions.getBoundingClientRect();
                    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) actions.close();
                }
            });
            if (window.SG_CACHE && window.SG_CACHE.supported) {
                bulkCache = window.SG_FAVORITES_CACHE.create({ storage: libraryStorage, key: PLAY_MODE_STORAGE_KEY + '_cache_job',
                    has: bvid => window.SG_CACHE.hasCached(bvid),
                    resolve: async function (bvid, mode, signal) { return (await biliClient.resolve(bvid, mode, false, { signal: signal })).proxyUrl; },
                    save: (bvid, blob) => window.SG_CACHE.saveToCache(bvid, blob),
                    canDownload: function () {
                        if (loadingBvid) return false;
                        const buffered = window.SG_PLAYBACK_BUFFER.ahead(bgmAudio);
                        return bgmAudio.paused || buffered >= 20 || Number.isFinite(bgmAudio.duration) && buffered + 0.25 >= bgmAudio.duration - bgmAudio.currentTime;
                    },
                    onSaved: function (bvid) {
                        cachedBvidsSet.add(bvid); updatePlayDownloadsButton(); playlistRenderKey = '';
                        if (viewPlaylist.classList.contains('is-open')) renderPlaylist();
                    },
                    onChange: renderBulkCache,
                });
            }
            function prepareBulkCache() {
                if (cancelAudioCacheDownload) { cancelAudioCacheDownload(); cancelAudioCacheDownload = null; }
            }
            document.getElementById('bulk-cache-start').addEventListener('click', function () {
                if (!bulkCache) return;
                prepareBulkCache();
                bulkCache.start(favoriteSongsForCache(), getCurrentAudioMode());
            });
            document.getElementById('bulk-cache-pause').addEventListener('click', () => bulkCache && bulkCache.pause());
            document.getElementById('bulk-cache-resume').addEventListener('click', function () { if (bulkCache) { prepareBulkCache(); bulkCache.resume(); } });
            document.getElementById('bulk-cache-retry').addEventListener('click', function () { if (bulkCache) { prepareBulkCache(); bulkCache.retry(); } });
            document.getElementById('bulk-cache-cancel').addEventListener('click', function () { if (bulkCache) bulkCache.cancel(); });
            syncLibraryTabs(); renderBulkCache();
        })();
