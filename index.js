        (function () {
            var navLink = document.querySelector('.nav-emoji-link');
            if (!navLink) return;
            navLink.addEventListener('click', function (e) {
                e.preventDefault();
                var href = navLink.getAttribute('href');
                if (!href) return;
                var x = e.clientX, y = e.clientY;
                var radius = Math.max(window.innerWidth, window.innerHeight) * 1.5;
                var overlay = document.createElement('div');
                overlay.className = 'nav-transition-overlay';
                overlay.style.background = 'rgba(244, 114, 168, 0.5)';
                overlay.style.clipPath = 'circle(0px at ' + x + 'px ' + y + 'px)';
                document.body.appendChild(overlay);
                requestAnimationFrame(function () {
                    overlay.style.clipPath = 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)';
                });
                overlay.addEventListener('transitionend', function () {
                    window.location.href = navLink.href;
                });
            });
        })();

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

        // --- 0. 配置中心 ---
        const DEFAULT_TITLE = '思诺 · Gladys';
        const CURRENT_VERSION = '0.0.9(测)';
        // 确保在任何函数使用前就声明当前播放的 bvid
        let currentPlayingBvid = '';

        // IndexedDB 可用性检测（由 lyrics-db.js 注入 window.SG_LYRICS）
        (function checkIdbSupport() {
            if (window.SG_LYRICS && !window.SG_LYRICS.supported) {
                var el = document.getElementById('toast');
                if (!el) return;
                el.textContent = '当前浏览器不支持 IndexedDB，无法使用自定义歌词功能。';
                el.classList.add('is-visible');
                setTimeout(function () { el.classList.remove('is-visible'); }, 6000);
            }
        })();
        // 如果你绑定了 api.snow-gladys.com，请使用下面第一行
        // const API_BASE = 'https://api.snow-gladys.com'; 
        // 如果没绑定成功，暂时用 Worker 原生地址：
        const API_BASE = 'https://snow-gladys-api-zone-3msnp1a62hlu-1304656834.eo-edgefunctions.com'; 

        // --- 1. 获取粉丝数逻辑 ---
        const fanCountElement = document.getElementById('fan-count');
        
        async function fetchFanCount() {
            try {
                const VMID_SINUO = '3537115310721781';
                const response = await fetch(`${API_BASE}/fans?vmid=${VMID_SINUO}`);
                if (!response.ok) throw new Error();
                
                const data = await response.json();
                if (data.code === 0) {
                    fanCountElement.innerText = data.data.follower.toLocaleString();
                }
            } catch (error) {
                console.error("粉丝数获取失败:", error);
                fanCountElement.innerText = '---';
            }
        }
        fetchFanCount(); // 立即运行一次

        // --- 1.5 收藏（Local Storage，容量大、无 cookie 上限）---
        const FAV_STORAGE_KEY = 'sg_fav';
        const PLAY_MODE_STORAGE_KEY = 'sg_play_mode';
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
            if (favoritesSet.size === 0 && playMode === 'favorites' && btnModeCycle) setPlayMode('list');
            updatePlayFavoritesButton();
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
            if (!btn) return;
            const hasDownloads = cachedBvidsSet && cachedBvidsSet.size > 0;
            btn.style.display = hasDownloads ? '' : 'none';
        }

        // --- 1.5.2 设置（Cookie）与自定义歌单（Local Storage）---
        const SETTINGS_COOKIE = 'sg_settings';
        const SETTINGS_MAX_AGE = 365 * 24 * 60 * 60;
        const CUSTOM_STORAGE_KEY = 'sg_custom_songs';

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
                const raw = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(SETTINGS_COOKIE + '='));
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
            var favRaw = document.cookie.split(';').map(function (s) { return s.trim(); }).find(function (s) { return s.startsWith('sg_fav='); });
            var customRaw = document.cookie.split(';').map(function (s) { return s.trim(); }).find(function (s) { return s.startsWith('sg_custom_songs='); });
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
        let settings = getSettingsFromCookie();
        let cachedBvidsSet = new Set();

        const viewHome = document.getElementById('view-home');
        const viewPlaylist = document.getElementById('view-playlist');
        const viewPlay = document.getElementById('view-play');
        const playlistListEl = document.getElementById('playlist-list');
        const playlistCountEl = document.getElementById('playlist-count');
        const playlistBackdrop = document.getElementById('playlist-backdrop');
        const playSongNameEl = document.getElementById('play-song-name');

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
        }

        const playlistSearchEl = document.getElementById('playlist-search');
        const playlistFilterBtn = document.getElementById('playlist-filter-btn');
        let playlistFilterFavorites = false;

        function openPlaylist(focusIndex) {
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
                const item = playlistListEl.querySelector(`[data-index="${scrollToIdx}"]`);
                if (item) item.scrollIntoView({ block: 'center', behavior: 'instant' });
            });
        }

        function closePlaylist() {
            showView(viewPlay.classList.contains('is-active') ? 'play' : 'home');
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
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'playlist-item' + (isCurrent ? ' current' : '');
            btn.dataset.bvid = s.bvid || '';
            btn.dataset.index = i;

            // 左侧主内容：歌名 + 徽标（用户、自定义、LIVE），结构对齐 tmp/playlist.html
            const mainWrap = document.createElement('span');
            mainWrap.className = 'playlist-item-main';

            const nameEl = document.createElement('span');
            nameEl.className = 'playlist-item-name';
            nameEl.textContent = s.name || s.title || '';
            mainWrap.appendChild(nameEl);

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
            btn.addEventListener('click', () => {
                playMusic(s.bvid || '');
                closePlaylist();
                showView('play');
            });
            return btn;
        }

        function renderPlaylist() {
            if (!playlistListEl) return;
            const query = (playlistSearchEl && playlistSearchEl.value || '').trim().toLowerCase();
            let items = songList.map((s, i) => ({ s, i }));
            if (playlistFilterFavorites) items = items.filter(({ s }) => isFavorite(s.bvid));
            const total = playlistFilterFavorites ? songList.filter(s => isFavorite(s.bvid)).length : songList.length;

            playlistListEl.innerHTML = '';

            // ── 搜索 / 收藏模式：原有逻辑，无分组 ──────────────────
            if (query) {
                items = items.filter(({ s }) => (s.name || s.title || '').toLowerCase().includes(query));
                items.sort((a, b) => {
                    const na = (a.s.name || a.s.title || '').toLowerCase();
                    const nb = (b.s.name || b.s.title || '').toLowerCase();
                    const aStart = na.startsWith(query) ? 0 : 1;
                    const bStart = nb.startsWith(query) ? 0 : 1;
                    if (aStart !== bStart) return aStart - bStart;
                    return na.localeCompare(nb);
                });
                if (playlistCountEl) playlistCountEl.textContent = items.length + ' / ' + total;
                const curBvid = currentPlayingBvid || '';
                items.forEach(({ s, i }) => playlistListEl.appendChild(createPlaylistItemEl(s, i, curBvid)));
                if (playlistAlphaBarEl) playlistAlphaBarEl.innerHTML = '';
                return;
            }

            // ── 普通模式：A-Z 分组排序 ───────────────────────────────
            if (playlistCountEl) playlistCountEl.textContent = total;

            // 计算排序键（缓存在 _sortKey 上避免重复查表）
            items.forEach(({ s }) => {
                if (!s._sortKey) s._sortKey = getSongSortLetter(s.name || s.title || '');
            });

            // 按字母排序（# 排最后）
            items.sort((a, b) => {
                const la = a.s._sortKey, lb = b.s._sortKey;
                if (la === '#' && lb !== '#') return 1;
                if (la !== '#' && lb === '#') return -1;
                if (la !== lb) return la < lb ? -1 : 1;
                return (a.s.name || '').localeCompare(b.s.name || '', 'zh-CN');
            });

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
            playlistListEl.appendChild(frag);
        }

        function buildSongList() {
            const out = [];
            if (settings.showMain) mainList.forEach(s => out.push({ name: s.name || s.title, bvid: s.bvid || '', isCustom: false, isLive: false }));
            if (settings.showLive) liveList.forEach(s => out.push({ name: s.name || s.title, bvid: s.bvid || '', isCustom: false, isLive: true }));
            if (settings.showCustom) customList.forEach(s => out.push({ name: s.name, bvid: s.bvid || '', isCustom: true, isLive: false }));
            // 清除缓存的排序键，以便重新计算
            out.forEach(s => { s._sortKey = undefined; });
            songList = out;
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
            try {
                const res = await fetch('./songs.json');
                if (res.ok) {
                    const data = await res.json();
                    mainList = Array.isArray(data) && data.length > 0 ? data : fallbackList;
                } else mainList = fallbackList;
            } catch (e) {
                console.warn('精选歌单加载失败，使用默认列表:', e);
                mainList = fallbackList;
            }
            try {
                const resLive = await fetch('./songs_live.json');
                if (resLive.ok) {
                    const data = await resLive.json();
                    liveList = Array.isArray(data) ? data : [];
                } else liveList = [];
            } catch (e) { liveList = []; }
            customList = getCustomFromStorage();
            buildSongList();
            renderPlaylist();
            runInitialPreload();
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
                    lines.push('本地歌词存储：' + formatBytes(idbBytes));
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
            a.download = 'custom_songs_sinuo.txt';
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
                        const bvid = String(item.bvid || '').trim();
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
                    '<span class="name" title="' + (x.item.name || '').replace(/"/g, '&quot;') + '"></span>' +
                    '<span class="bvid"></span>' +
                    '<button type="button" class="btn-edit">修改</button>' +
                    '<button type="button" class="btn-del">删除</button>' +
                    '<span class="del-confirm-bar"><span class="del-confirm-label">确定删除？</span>' +
                    '<button type="button" class="btn-del-yes">删除</button>' +
                    '<button type="button" class="btn-del-no">取消</button></span>';
                row.querySelector('.name').textContent = x.item.name || '—';
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
                    if (delBvid && window.SG_LYRICS && window.SG_LYRICS.supported) {
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

        function openCustomForm(editIndex) {
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
                        lyricsIn.value = lrc || '';
                        lyricsIn.placeholder = '[00:00.00] 第一行歌词\n[00:05.00] 第二行歌词\n留空则不修改已有歌词';
                    });
                } else if (lyricsIn) {
                    lyricsIn.value = '';
                }
            } else {
                title.textContent = '添加自定义歌曲';
                nameIn.value = '';
                bvidIn.value = '';
                if (lyricsIn) lyricsIn.value = '';
                delete nameIn.dataset.editIndex;
            }
            backdrop.classList.add('is-open');
            setTimeout(() => nameIn.focus(), 100);
        }

        function closeCustomForm() {
            document.getElementById('custom-form-backdrop').classList.remove('is-open');
        }

        function isValidBvidFormat(bvid) {
            return /^BV[a-zA-Z0-9]{10}$/.test(String(bvid || '').trim());
        }

        /** 通过 Worker /valid 校验 BVID 是否存在。返回值: 'valid' | 'invalid' | 'unknown'（bvid 保持用户输入大小写） */
        async function validateBvidExists(bvid) {
            const b = String(bvid || '').trim();
            if (!isValidBvidFormat(b)) return 'invalid';
            try {
                const res = await fetch(`${API_BASE}/valid?bvid=${encodeURIComponent(b)}`, { method: 'GET' });
                const json = await res.json().catch(() => ({}));
                if (json && json.valid === true) return 'valid';
                if (json && json.valid === false) return 'invalid';
                return 'unknown';
            } catch (e) { return 'unknown'; }
        }

        function submitCustomForm() {
            const nameIn = document.getElementById('custom-form-name');
            const bvidIn = document.getElementById('custom-form-bvid');
            const lyricsIn = document.getElementById('custom-form-lyrics');
            const name = (nameIn.value || '').trim();
            const bvid = (bvidIn.value || '').trim();
            const lrcText = lyricsIn ? (lyricsIn.value || '').trim() : '';
            if (!name) { alert('请输入歌名'); return; }
            if (!isValidBvidFormat(bvid)) { alert('无效的BVID，请重新输入。'); return; }
            (async function () {
                var result = await validateBvidExists(bvid);
                if (result === 'invalid') { alert('无效的BVID，请重新输入。'); return; }
                if (result === 'unknown' && !confirm('无法验证该 BVID 是否存在（可能因网络限制），是否仍要添加？')) return;
                const editIndex = nameIn.dataset.editIndex != null ? parseInt(nameIn.dataset.editIndex, 10) : -1;
                if (editIndex >= 0 && editIndex < customList.length) {
                    customList[editIndex] = { name, bvid };
                } else {
                    customList.push({ name, bvid });
                }
                saveCustomToStorage(customList);
                buildSongList();
                renderPlaylist();
                renderCustomSectionInSettings();
                // 保存歌词（有填写则保存，未填写则不操作，编辑时也不清空已存歌词）
                if (lrcText && window.SG_LYRICS && window.SG_LYRICS.supported) {
                    await window.SG_LYRICS.saveUserLrc(bvid, lrcText).catch(function () {});
                    // 如果当前正在播放此曲，刷新歌词
                    if (currentPlayingBvid && currentPlayingBvid === bvid) {
                        lyricsReloadForCurrentSong();
                    }
                }
                closeCustomForm();
            })();
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
                        settings.audioMode = mode;
                        saveSettingsToCookie(settings);
                        syncQualityButtons();
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
                    try {
                        await window.SG_CACHE.clearAll();
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
                const i = getRandomIndex(songList.length, -1);
                playMusic(songList[i].bvid || '');
                showView('play');
            });
        }

        const btnPlayFavorites = document.getElementById('btn-play-favorites');
        if (btnPlayFavorites) {
            btnPlayFavorites.addEventListener('click', () => {
                const favList = getFavoritesList();
                if (!favList.length) return;
                setPlayMode('favorites');
                playMusic(favList[0].bvid || '');
                showView('play');
            });
        }
        const btnPlayDownloads = document.getElementById('btn-play-downloads');
        if (btnPlayDownloads) {
            btnPlayDownloads.addEventListener('click', () => {
                const dlList = getDownloadedList();
                if (!dlList.length) {
                    showToast('当前没有已下载歌曲', 2600);
                    return;
                }
                setPlayMode('downloaded');
                playMusic(dlList[0].bvid || '');
                showView('play');
            });
        }

        if (playlistBackdrop) {
            playlistBackdrop.addEventListener('click', closePlaylist);
        }
        const btnClosePlaylist = document.getElementById('btn-close-playlist');
        if (btnClosePlaylist) btnClosePlaylist.addEventListener('click', closePlaylist);

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
        let bgmAudio = new Audio();
        bgmAudio.crossOrigin = "anonymous"; // 允许跨域
        document.body.appendChild(bgmAudio);

        // ── 播放页 / 歌词页频谱（基于 Web Audio，与 bgmAudio 联动） ─────────────
        const playVisualizerEl = document.getElementById('play-visualizer');
        let audioCtx = null;
        let audioAnalyser = null;
        let audioSourceNode = null;
        let audioSourceEl = null;
        let visualizerBars = [];
        let envelopeArray = [];
        // PiP 频谱容器与柱子（与主播放页共用同一个 Analyser 数据）
        let pipVisualizerEl = null;
        let pipVisualizerBars = [];
        let visualizerRafId = null;

        function ensureAudioAnalyser() {
            if (window.innerWidth <= 768) return;

            if (!playVisualizerEl) return;
            if (!window.AudioContext && !window.webkitAudioContext) return;
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (!audioAnalyser) {
                audioAnalyser = audioCtx.createAnalyser();
                audioAnalyser.fftSize = 2048;
                audioAnalyser.smoothingTimeConstant = 0.85;
            }
            // 如果 bgmAudio 被替换（例如预加载切换），重新创建 source
            if (audioSourceEl !== bgmAudio) {
                if (audioSourceNode) {
                    try { audioSourceNode.disconnect(); } catch (e) {}
                }
                audioSourceNode = audioCtx.createMediaElementSource(bgmAudio);
                audioSourceNode.connect(audioAnalyser);
                audioAnalyser.connect(audioCtx.destination);
                audioSourceEl = bgmAudio;
            }
            // 初始化频谱柱
            if (!visualizerBars.length) {
                playVisualizerEl.innerHTML = '';
                const barCount = 100;
                for (let i = 0; i < barCount; i++) {
                    const bar = document.createElement('div');
                    bar.className = 'bar';
                    playVisualizerEl.appendChild(bar);
                    visualizerBars.push(bar);
                }
            }

            // --- 动态计算逻辑 ---
            const containerWidth = playVisualizerEl.offsetWidth;
            if (containerWidth === 0) return; // 【修复1】：防止在隐藏状态下宽度为0，导致柱形被清空

            const barWidth = 3;  // 与 CSS 一致
            const barGap = 2;    // margin 左右各 1px
            const newBarCount = Math.floor(containerWidth / (barWidth + barGap));

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
            if (window.innerWidth <= 768) return;

            if (!playVisualizerEl) return;
            ensureAudioAnalyser();
            if (!audioCtx || !audioAnalyser) return;
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(function () { });
            }
            const bufferLength = audioAnalyser.frequencyBinCount;
            // 提出来，防止重复创建
            if (!window.audioDataArray || window.audioDataArray.length !== bufferLength) {
                window.audioDataArray = new Uint8Array(bufferLength);
            }

            function renderFrame() {
                // 【黑科技修复2】：当开启小窗时，强行征用小窗的 requestAnimationFrame！
                // 这样即使用户把主网页切到后台甚至最小化，小窗的频谱依然能保持 60 帧流畅跳动！
                const rafWindow = pipWindow || window;
                visualizerRafId = rafWindow.requestAnimationFrame(renderFrame);
                
                audioAnalyser.getByteFrequencyData(window.audioDataArray);
                const usefulBins = Math.floor(audioAnalyser.frequencyBinCount * 0.35); 
                
                // === 独立渲染主界面频谱 ===
                if (visualizerBars.length > 0 && viewPlay.classList.contains('is-active')) {
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
                if (pipVisualizerBars && pipVisualizerBars.length > 0) {
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
            if (visualizerRafId) {
                cancelAnimationFrame(visualizerRafId);
                visualizerRafId = null;
            }
        }
        let globalPreloadAudio = new Audio(); // 全局预加载对象
        globalPreloadAudio.crossOrigin = "anonymous";
        document.body.appendChild(globalPreloadAudio); 

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
            loadingInfoEl.innerHTML =
                '<div class="loading-title">歌曲《' + songName + '》加载中</div>' +
                '<div class="loading-detail">' + detail + '</div>';
        }

        function hideLoadingInfo() {
            loadingBvid = null;
            loadingStartTime = null;
            if (loadingInfoTimer) { clearInterval(loadingInfoTimer); loadingInfoTimer = null; }
            if (loadingInfoEl) loadingInfoEl.classList.remove('is-visible');
        }

        // 封装事件监听绑定逻辑，因为每次"偷梁换柱"后都需要重新绑定
        function bindAudioEvents(audioObj) {
            // 移除旧的监听器（虽然新对象没有监听器，但这是一个好习惯）
            audioObj.removeEventListener('timeupdate', updateProgressDisplay);
            audioObj.removeEventListener('loadedmetadata', updateProgressDisplay);
            audioObj.removeEventListener('ended', handleAudioEnded);
            audioObj.removeEventListener('play', handleAudioPlay);
            audioObj.removeEventListener('pause', handleAudioPause);

            audioObj.addEventListener('timeupdate', updateProgressDisplay);
            audioObj.addEventListener('loadedmetadata', updateProgressDisplay);
            audioObj.addEventListener('ended', handleAudioEnded);
            audioObj.addEventListener('play', handleAudioPlay);
            audioObj.addEventListener('pause', handleAudioPause);
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
            updatePlayPauseIcon();
            if (currentPlayingBvid) startVisuals(currentPlayingBvid);
            updateMediaSession();
        }
        function handleAudioPause() {
            updatePlayPauseIcon();
            stopVisuals();
            updateMediaSession();
        }

        // 初始化绑定
        bindAudioEvents(bgmAudio);
        
        const characterImg = document.querySelector('.character-img');

        // 默认进入首页视图，确保初始不会显示播放页的黑胶与控制条
        showView('home');

        // --- 预加载与 API 调用（在结束前一定时间尝试直链预加载）---
        const PRELOAD_AHEAD_SEC = 10;
        let preloadCache = null;
        let preloadInFlight = null;
        let preloadScheduledForBvid = null;
        /** 随机模式下「已确定的下一首」bvid，与预加载一致，保证能命中缓存 */
        let nextRandomBvid = null;

        /** 延时 ms 毫秒 */
        function sleep(ms) {
            return new Promise(function (r) { setTimeout(r, ms); });
        }

        /** 根据 bvid 取歌名（用于弹窗提示） */
        function getSongNameByBvid(bvid) {
            var s = songList.find(function (x) { return (x.bvid || '') === (bvid || ''); });
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

        /** 只调用一次 resolvehtml API（不处理 403），返回 { url } 或 null */
        function fetchResolveHtml(bvid) {
            var mode = getCurrentAudioMode();
            var apiUrl = API_BASE + '/resolvehtml?bvid=' + encodeURIComponent(bvid) + '&mode=' + encodeURIComponent(mode);
            return fetch(apiUrl).then(function (res) { return res.json(); }).then(function (data) {
                return data && data.url ? { url: data.url } : null;
            }).catch(function () { return null; });
        }

        /**
         * 使用 resolve + proxy 的方式获取最终可播放地址：
         * 1) /resolve 拿到 B 站真实音频地址
         * 2) 前端通过 /proxy 转发该地址，避免直接命中 B 站 403
         * 返回 { url }（此 url 已经是 proxy 地址）
         */
        function fetchResolveViaProxy(bvid) {
            var mode = getCurrentAudioMode();
            var apiUrl = API_BASE + '/resolve?bvid=' + encodeURIComponent(bvid) + '&mode=' + encodeURIComponent(mode);
            return fetch(apiUrl).then(function (res) { return res.json(); }).then(function (data) {
                if (data && data.url) {
                    var proxied = API_BASE + '/proxy?url=' + encodeURIComponent(data.url);
                    return { url: proxied };
                }
                return null;
            }).catch(function () { return null; });
        }

        /**
         * 获取可播放的 realUrl。
         *  - 若有 initialUrl（预加载得到的直链），先对该地址做一次 HEAD 探测，非 403 则直接使用；
         *  - 其他情况（无预加载 / 直链不可用）直接使用 resolve + proxy，保证稳定性。
         * @returns Promise<string | null> 可用的 realUrl 或 null
         */
        async function getLoadableRealUrl(bvid, initialUrl) {
            // var realUrl = initialUrl || null;
            // if (realUrl) {
            //     try {
            //         var res = await fetch(realUrl, { method: 'HEAD' });
            //         if (res.status !== 403) return realUrl;
            //         console.warn('预加载直链不可用，状态码:', res.status);
            //     } catch (e) {
            //         console.warn('预加载直链探测异常，将回退 proxy:', e);
            //     }
            //     realUrl = null;
            // }
            // // 无预加载或预加载直链不可用：直接走 proxy
            // var result = await fetchResolveViaProxy(bvid);
            // if (!result || !result.url) return null;
            // return result.url;
            // 1. 如果有预加载的链接，直接使用（无条件信任，消除卡顿）
            if (initialUrl) {
                return initialUrl; 
            }
            
            // 2. 如果没有预加载，才去请求新的地址
            var result = await fetchResolveViaProxy(bvid);
            if (!result || !result.url) return null;
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
            if (document.hidden) return;

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

        const MODE_TITLES = {
            list: '列表循环',
            single: '单曲循环',
            random: '随机播放',
            favorites: '收藏列表循环',
            downloaded: '播放下载'
        };
        function setPlayMode(mode) {
            playMode = mode;
            if (mode !== 'random') nextRandomBvid = null;
            if (btnModeCycle) {
                btnModeCycle.classList.remove('is-mode-list', 'is-mode-single', 'is-mode-random', 'is-mode-favorites', 'is-mode-downloaded');
                btnModeCycle.classList.add('is-mode-' + (mode || 'list'));
                btnModeCycle.title = MODE_TITLES[mode] || MODE_TITLES.list;
            }
            try { localStorage.setItem(PLAY_MODE_STORAGE_KEY, mode || 'list'); } catch (e) {}
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
            if (playMode === 'favorites') return getFavoritesList();
            if (playMode === 'downloaded') return getDownloadedList();
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
            const list = getEffectiveList();
            if (!list.length) return null;
            const idxEff = getCurrentIndexInEffectiveList();
            if (playMode === 'single') return currentPlayingBvid;
            if (playMode === 'random') {
                const idx = getCurrentIndex();
                const i = getRandomIndex(songList.length, idx);
                return songList[i].bvid || null;
            }
            if (playMode === 'favorites') {
                const nextIdx = idxEff < 0 ? 0 : (idxEff + 1) % list.length;
                return list[nextIdx].bvid || null;
            }
            const idx = getCurrentIndex();
            const nextIdx = idx < 0 ? 0 : (idx + 1) % songList.length;
            return songList[nextIdx].bvid || null;
        }

        function clearPreload() {
            preloadCache = null;
            preloadInFlight = null;
            nextRandomBvid = null;
        }

        /** 首页进入时静默预加载一首歌（不播放、不展示），以便首次播放时提速；随机选一首 */
        function runInitialPreload() {
            if (songList.length === 0) return;
            if (currentPlayingBvid) return;
            var idx = getRandomIndex(songList.length, -1);
            var bvid = (songList[idx].bvid || '').trim();
            if (!bvid) return;
            fetchResolveViaProxy(bvid).then(function (result) {
                if (!result || !result.url) return;
                if (currentPlayingBvid) return;
                preloadCache = { bvid: bvid, url: result.url };
                globalPreloadAudio.src = result.url;
                globalPreloadAudio.load();
            }).catch(function () {});
        }

        /** 停止初始预加载（进入播放页且播放的不是预加载曲目时调用，避免后台继续加载） */
        function stopInitialPreload() {
            if (!globalPreloadAudio) return;
            globalPreloadAudio.src = '';
            globalPreloadAudio.load();
        }

        /**
         * 异步预取下一首的播放地址并缓存；
         * 使用 resolvehtml 直链方式，最多尝试 2 次，不做 403 探测，
         * 实际播放时若直链不可用会自动回退到 proxy。
         */
        function tryPreloadNext() {
            const nextBvid = getNextBvid();
            if (!nextBvid || nextBvid === currentPlayingBvid) return;
            if (preloadCache && preloadCache.bvid === nextBvid) return;
            if (preloadInFlight === nextBvid) return;
            preloadInFlight = nextBvid;
            if (playMode === 'random') nextRandomBvid = nextBvid;
            (async function () {
                let result = null;
                for (let attempt = 1; attempt <= 2; attempt++) {
                    // result = await fetchResolveHtml(nextBvid);
                    result = await fetchResolveViaProxy(nextBvid);
                    if (result && result.url) {
                        try {
                            var res = await fetch(result.url, { method: 'HEAD' });
                            if (res.status !== 403) break;
                            console.warn('重试网址:', result.url, '返回码:', res.status);
                        } catch (e) {
                            console.warn('重试网址:', result.url, '返回码: 请求异常', e);
                        }
                    }
                    await sleep(500 + Math.random() * 500);
                }
                const url = result && result.url;
                if (url && preloadInFlight === nextBvid) {
                    preloadCache = { bvid: nextBvid, url: url };
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

        /** 剩余时间 ≤ PRELOAD_AHEAD_SEC 时触发一次预加载 */
        function onTimeUpdateForPreload() {
            var d = bgmAudio.duration;
            var t = bgmAudio.currentTime;
            if (!isFinite(d) || d <= 0) return;
            if (d - t > PRELOAD_AHEAD_SEC) return;
            if (currentPlayingBvid === preloadScheduledForBvid) return;
            preloadScheduledForBvid = currentPlayingBvid;
            tryPreloadNext();
        }

        function playNextByMode() {
            const list = getEffectiveList();
            if (!list.length) return;
            const idxEff = getCurrentIndexInEffectiveList();
            if (playMode === 'single' && currentPlayingBvid) {
                if (bgmAudio.src) {
                    bgmAudio.currentTime = 0;
                    bgmAudio.play();
                    startVisuals(currentPlayingBvid);
                    updatePlayPauseIcon();
                } else {
                    playMusic(currentPlayingBvid);
                }
                return;
            }
            if (playMode === 'random') {
                if (nextRandomBvid) {
                    const b = nextRandomBvid;
                    nextRandomBvid = null;
                    playMusic(b);
                } else {
                    const idx = getCurrentIndex();
                    const i = getRandomIndex(songList.length, idx);
                    playMusic(songList[i].bvid || '');
                }
                return;
            }
            if (playMode === 'favorites') {
                const nextIdx = idxEff < 0 ? 0 : (idxEff + 1) % list.length;
                playMusic(list[nextIdx].bvid || '');
                return;
            }
            const idx = getCurrentIndex();
            const nextIdx = idx < 0 ? 0 : (idx + 1) % songList.length;
            playMusic(songList[nextIdx].bvid || '');
        }

        function updatePlayPauseIcon() {
            if (btnPlayPause) {
                btnPlayPause.classList.toggle('is-playing', !bgmAudio.paused);
                btnPlayPause.title = bgmAudio.paused ? '播放' : '暂停';
            }
            updateDocumentTitle();
        }

        function updatePlaySongName() {
            if (!playSongNameEl) return;
            const idx = getCurrentIndex();
            if (idx >= 0 && songList[idx]) {
                playSongNameEl.textContent = songList[idx].name || songList[idx].title || '—';
            } else {
                playSongNameEl.textContent = currentPlayingBvid ? '…' : '—';
            }
            updateFavButton();
            updateDocumentTitle();
        }

        function updateDocumentTitle() {
            if (currentPlayingBvid && !bgmAudio.paused) {
                const idx = getCurrentIndex();
                const name = (idx >= 0 && songList[idx]) ? (songList[idx].name || songList[idx].title || '—') : '…';
                document.title = name + ' · 思诺';
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
                    const idx = getCurrentIndex();
                    const name = (idx >= 0 && songList[idx]) ? (songList[idx].name || songList[idx].title || '—') : '—';
                    const useLockscreenLyric = (settings && settings.lockscreenLyric) === 'on';
                    const hasLyrics = typeof currentLyrics !== 'undefined' && currentLyrics && currentLyrics.length > 0;
                    const currentTxt = (hasLyrics && currentLyricIndex >= 0 && currentLyrics[currentLyricIndex])
                        ? (currentLyrics[currentLyricIndex].text || '') : '';
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: (useLockscreenLyric && hasLyrics) ? (currentTxt || name) : name,
                        artist: (useLockscreenLyric && hasLyrics) ? (name + ' · 思诺') : '思诺',
                        album: ''
                    });
                }
                navigator.mediaSession.setActionHandler('play', function () {
                    if (bgmAudio.src) bgmAudio.play();
                });
                navigator.mediaSession.setActionHandler('pause', function () {
                    bgmAudio.pause();
                });
                navigator.mediaSession.setActionHandler('previoustrack', function () { goPrev(); });
                navigator.mediaSession.setActionHandler('nexttrack', function () { goNext(); });
            } catch (e) { /* 部分环境不支持或 setActionHandler 不可用 */ }
        }

        // 播放函数（预加载缓存 + getLoadableRealUrl 探测 403 重试，失败则弹窗并自动下一首）
        async function playMusic(bvid) {
            if (!bvid) return;

            preloadScheduledForBvid = null;

            const useCache = !!(settings && settings.cacheEnabled === 'on' && window.SG_CACHE && window.SG_CACHE.supported);

            // 若已开启缓存，优先尝试从 IndexedDB 读取缓存播放
            if (useCache && window.SG_CACHE && typeof window.SG_CACHE.getCachedBlob === 'function') {
                try {
                    const cachedBlob = await window.SG_CACHE.getCachedBlob(bvid);
                    if (cachedBlob) {
                        stopInitialPreload();
                        clearPreload();
                        currentPlayingBvid = bvid;

                        const objectUrl = URL.createObjectURL(cachedBlob);
                        bgmAudio.pause();
                        bgmAudio.src = objectUrl;
                        bgmAudio.volume = 0.5;

                        showLoadingInfo(bvid, 'buffering');
                        updateProgressDisplay();
                        updatePlaySongName();

                        try {
                            await bgmAudio.play();
                            hideLoadingInfo();
                            startVisuals(bvid);
                            updatePlayPauseIcon();
                            updateMediaSession();
                        } catch (errCache) {
                            hideLoadingInfo();
                            handlePlayError(bvid, errCache);
                            updatePlayPauseIcon();
                        }
                        return;
                    }
                } catch (e) { /* 缓存异常时回退到正常流程 */ }
            }

            // 标记：是否使用了预加载对象
            let usePreloadObject = false;
            var initialUrl = null;

            if (preloadCache && (preloadCache.bvid || '').toUpperCase() === (bvid || '').toUpperCase()) {
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
                var mode = getCurrentAudioMode();
                var resolveRes = await fetch(API_BASE + '/resolve?bvid=' + encodeURIComponent(bvid) + '&mode=' + encodeURIComponent(mode))
                    .then(function (r) { return r.json(); })
                    .catch(function () { return null; });
                if (!resolveRes || !resolveRes.url) {
                    hideLoadingInfo();
                    handlePlayError(bvid, 'NO_URL');
                    return;
                }
                showLoadingInfo(bvid, 'proxy');
                realUrl = API_BASE + '/proxy?url=' + encodeURIComponent(resolveRes.url);
            }

            if (!realUrl) {
                hideLoadingInfo();
                handlePlayError(bvid, 'NO_URL');
                return;
            }

            currentPlayingBvid = bvid;

            if (usePreloadObject && realUrl === initialUrl) {
                bgmAudio.pause();
                let oldAudio = bgmAudio;
                bgmAudio = globalPreloadAudio;

                bindAudioEvents(bgmAudio);

                bgmAudio.volume = 0.5;
                bgmAudio.crossOrigin = "anonymous";

                globalPreloadAudio = new Audio();

                // 销毁旧对象前先移除其事件监听，否则清空 src 时可能触发 ended，导致多切一首
                oldAudio.removeEventListener('timeupdate', updateProgressDisplay);
                oldAudio.removeEventListener('loadedmetadata', updateProgressDisplay);
                oldAudio.removeEventListener('ended', handleAudioEnded);
                oldAudio.removeEventListener('play', handleAudioPlay);
                oldAudio.removeEventListener('pause', handleAudioPause);
                oldAudio.src = "";
                oldAudio.load();
                oldAudio = null;
            } else {
                // 没命中预加载：停止初始预加载，避免后台继续加载
                stopInitialPreload();
                bgmAudio.src = realUrl;
                bgmAudio.volume = 0.5;
            }

            showLoadingInfo(bvid, 'buffering');
            updateProgressDisplay();
            updatePlaySongName();

        try {
                await bgmAudio.play();
                hideLoadingInfo();
                startVisuals(bvid);
                updatePlayPauseIcon();
                updateMediaSession();
            } catch (err) {
                console.error("播放失败:", err);
                // 预加载的链接失效了，尝试重新获取一次 Proxy 链接
                if (realUrl === initialUrl) {
                    console.log("预加载链接似乎失效，尝试重新获取链接...");
                    // 强制不传 initialUrl，让它去服务器重新拿
                    var retryUrl = await getLoadableRealUrl(bvid, null);
                    if (retryUrl) {
                        // 递归调用自己，再试一次
                        playMusic(bvid); 
                        return; 
                    }
                }
                hideLoadingInfo();
                handlePlayError(bvid, err);
                updatePlayPauseIcon(); 
                return;
            }

            // 播放成功后，如已开启缓存，则在后台拉取音频并写入 IndexedDB（避免阻塞播放）
            if (useCache && window.SG_CACHE && window.SG_CACHE.supported &&
                typeof window.SG_CACHE.saveToCache === 'function' &&
                typeof window.SG_CACHE.getCachedBlob === 'function' && realUrl) {
                try {
                    window.SG_CACHE.getCachedBlob(bvid).then(function (blob) {
                        if (blob) return null;
                        return fetch(realUrl).then(function (r) {
                            if (!r.ok) return null;
                            return r.blob();
                        }).then(function (blob2) {
                            if (blob2) {
                                window.SG_CACHE.saveToCache(bvid, blob2);
                                if (cachedBvidsSet) {
                                    cachedBvidsSet.add(bvid);
                                    updatePlayDownloadsButton();
                                }
                            }
                        }).catch(function () { });
                    }).catch(function () { });
                } catch (e) { }
            }

            await bgmAudio.play();
            startVisuals(bvid);
            updatePlayPauseIcon();
            updateMediaSession();
        }

        function handlePlayError(bvid, errOrCode) {
            if (errOrCode && typeof errOrCode === 'object' && errOrCode.name === 'AbortError' && errOrCode.code === 20) return;
            var songName = getSongNameByBvid(bvid);
            stopVisuals();
            var codeStr = '—';
            if (errOrCode !== undefined && errOrCode !== null) {
                if (typeof errOrCode === 'string') {
                    codeStr = errOrCode;
                } else if (errOrCode && typeof errOrCode === 'object') {
                    if (errOrCode.name) {
                        codeStr = errOrCode.name + (errOrCode.code !== undefined ? ' ' + errOrCode.code : '');
                        if (errOrCode.message && String(errOrCode.message).trim()) codeStr += ' ' + String(errOrCode.message).trim();
                    } else {
                        codeStr = (errOrCode.message && String(errOrCode.message).trim()) || String(errOrCode);
                    }
                }
            }
            showToast('对不起小伙伴，出现了一些错误。可能是点击过快，也可能是神秘阿B力量暂时拒绝了歌曲《' + songName + '》的访问，之后可再重试喵。错误码：' + codeStr);
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

        // 播放/暂停按钮
        btnPlayPause.addEventListener('click', () => {
            if (bgmAudio.paused) {
                if (bgmAudio.src) {
                    // 长时间暂停后浏览器可能静默断开网络连接（readyState < 2），
                    // 原地 seek 可强制重新触发请求，避免 play() 静默失败
                    // if (bgmAudio.readyState < 2 && isFinite(bgmAudio.currentTime)) {
                    //     bgmAudio.currentTime = bgmAudio.currentTime;
                    // }
                    bgmAudio.play();
                    if (currentPlayingBvid) {
                        const deg = getRecordRotationDeg(characterImg);
                        characterImg.style.setProperty('--start-deg', deg + 'deg');
                        characterImg.style.removeProperty('transform');
                        characterImg.classList.add('is-playing');
                        updatePlaySongName();
                    }
                    updatePlayPauseIcon();
                } else if (songList.length) {
                    playMusic(songList[0].bvid || '');
                }
            } else {
                bgmAudio.pause();
                stopVisuals();
                updatePlayPauseIcon();
            }
        });

        // 模式循环按钮：列表 → 单曲 → 随机 →（有收藏时）播放收藏 → 列表
        function getModeOrder() {
            const base = ['list', 'single', 'random'];
            if (favoritesSet.size) base.push('favorites');
            if (cachedBvidsSet && cachedBvidsSet.size) base.push('downloaded');
            return base;
        }
        if (btnModeCycle) {
            btnModeCycle.addEventListener('click', () => {
                const order = getModeOrder();
                let idx = order.indexOf(playMode);
                if (idx < 0) idx = 0;
                const next = order[(idx + 1) % order.length];
                setPlayMode(next);
            });
        }
        (function initPlayMode() {
            var saved = '';
            try { saved = localStorage.getItem(PLAY_MODE_STORAGE_KEY) || ''; } catch (e) {}
            if (['list', 'single', 'random', 'favorites', 'downloaded'].indexOf(saved) < 0) saved = 'list';
            if (saved === 'favorites' && favoritesSet.size === 0) saved = 'list';
            if (saved === 'downloaded' && (!cachedBvidsSet || !cachedBvidsSet.size)) saved = 'list';
            setPlayMode(saved);
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
            const idxEff = getCurrentIndexInEffectiveList();
            if (playMode === 'random') {
                const idx = getCurrentIndex();
                const i = getRandomIndex(songList.length, idx);
                playMusic(songList[i].bvid || '');
            } else {
                const prevIdx = idxEff <= 0 ? list.length - 1 : idxEff - 1;
                playMusic(list[prevIdx].bvid || '');
            }
        }
        function goNext() {
            const list = getEffectiveList();
            if (!list.length) return;
            const idxEff = getCurrentIndexInEffectiveList();
            if (playMode === 'random') {
                if (nextRandomBvid) {
                    const b = nextRandomBvid;
                    nextRandomBvid = null;
                    playMusic(b);
                } else {
                    const idx = getCurrentIndex();
                    const i = getRandomIndex(songList.length, idx);
                    playMusic(songList[i].bvid || '');
                }
            } else {
                const nextIdx = idxEff < 0 ? 0 : (idxEff + 1) % list.length;
                playMusic(list[nextIdx].bvid || '');
            }
        }
        if (btnPrev) btnPrev.addEventListener('click', goPrev);
        if (btnNext) btnNext.addEventListener('click', goNext);

        // 点击圆环：暂停 / 继续（只在播放页生效）
        characterImg.addEventListener('click', () => {
            if (!viewPlay.classList.contains('is-active')) return;
            if (!bgmAudio.paused) {
                bgmAudio.pause();
                stopVisuals();
            } else if (bgmAudio.src) {
                bgmAudio.play();
                if (currentPlayingBvid) {
                    startVisuals(currentPlayingBvid);
                }
            }
            updatePlayPauseIcon();
        });

        // 尽早注册控制中心/锁屏的 play/pause/上一首/下一首，避免 iOS 暂停后点播放无响应
        updateMediaSession();

        // ── Picture-in-Picture 小窗播放 ──────────────────────────────
        const btnPip = document.getElementById('btn-pip');
        let pipWindow = null;

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
                pipWindow.document.querySelector('.pip-play').addEventListener('click', function () {
                    if (bgmAudio.paused) {
                        if (bgmAudio.src) { bgmAudio.play(); updatePlayPauseIcon(); }
                        else if (songList.length) playMusic(songList[0].bvid || '');
                    } else {
                        bgmAudio.pause(); stopVisuals(); updatePlayPauseIcon();
                    }
                });
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
                    pipWindow = null;
                    pipVisualizerEl = null;
                    pipVisualizerBars = [];
                    if (btnPip) btnPip.classList.remove('is-pip-open');
                });

                if (btnPip) btnPip.classList.add('is-pip-open');
                syncPipUI();

                // 【强制激活引擎】：如果在后台开启小窗，确保渲染循环启动
                if (!bgmAudio.paused) {
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
        var lyricsViewOpen = false;     // 是否处于歌词全屏视图
        var userHasLyric = false;       // 当前曲目是否有用户自定义歌词

        // 调轴模式状态
        var adjustMode = false;         // 是否处于调轴模式
        var adjustLyrics = null;        // 调轴中的歌词副本 [{time, text}]
        var adjustBvid = '';            // 调轴对应的 bvid

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
            if (btnLyrics) btnLyrics.classList.toggle('is-lyrics-open', lyricsViewOpen);
            // 歌词模式下：保留唱片可见，仅根据需要禁用交互
            var charLayer = document.querySelector('.character-layer');
            if (charLayer) {
                charLayer.style.opacity = '';
                charLayer.style.pointerEvents = lyricsViewOpen ? 'none' : '';
            }
            if (lyricsViewOpen) {
                lyricsFirstScrollDone = false; // 每次进入歌词模式重新计算第一次滚动
                renderLyricsScroll();
            }
        }

        /** 将 [{time, text}] 转换为 LRC 文本 */
        function lyricsToLrcText(lines) {
            return lines.filter(function (l) { return l.text; }).map(function (l) {
                var t = l.time;
                var min = Math.floor(t / 60);
                var sec = Math.floor(t % 60);
                var ms = Math.round((t - Math.floor(t)) * 100);
                return '[' + String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(ms).padStart(2, '0') + '] ' + l.text;
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
            if (!lyricsScrollEl) return;
            lyricsScrollEl.innerHTML = '';

            // 找到 renderLyricsScroll 里的空状态处理部分
            if (!currentLyrics || currentLyrics.length === 0) {
                var emptyDiv = document.createElement('div');
                emptyDiv.className = 'lyrics-empty';
                
                var emptyText = document.createElement('div');
                emptyText.className = 'lyrics-empty-text';
                emptyText.textContent = '暂无歌词，小伙伴可自行添加 LRC 格式歌词。';
                emptyDiv.appendChild(emptyText);

                if (window.SG_LYRICS && window.SG_LYRICS.supported) {
                    var addBtn = document.createElement('button');
                    addBtn.type = 'button';
                    addBtn.className = 'btn-add-lyric';
                    // 加上一个小小的 + 号图标
                    addBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        添加歌词
                    `;
                    addBtn.addEventListener('click', function () {
                        openLyricForm(currentPlayingBvid || '', '');
                    });
                    emptyDiv.appendChild(addBtn);
                }
                lyricsScrollEl.appendChild(emptyDiv);
                return;
            }

            // 渲染歌词行
            currentLyrics.forEach(function (line, idx) {
                if (!line.text) return; // 跳过空行
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'lyric-line' + (idx === currentLyricIndex ? ' active' : '');
                btn.dataset.idx = idx;
                btn.textContent = line.text;
                btn.addEventListener('click', function () {
                    var t = currentLyrics[idx].time;
                    if (isFinite(bgmAudio.duration) && bgmAudio.duration > 0) {
                        bgmAudio.currentTime = t;
                        // 重置索引，确保 updateLyricHighlight 一定执行 DOM 高亮刷新
                        currentLyricIndex = -1;
                        updateProgressDisplay();
                    }
                });
                lyricsScrollEl.appendChild(btn);
            });

            // 滚动到当前行
            scrollToActiveLyric(false);
        }

        /** 根据当前播放时间更新高亮歌词行 */
        function updateLyricHighlight() {
            if (!currentLyrics || !currentLyrics.length) return;
            var t = bgmAudio.currentTime;
            var newIdx = -1;
            for (var i = currentLyrics.length - 1; i >= 0; i--) {
                if (t >= currentLyrics[i].time) { newIdx = i; break; }
            }
            // 更新单行提示
            var txt = (newIdx >= 0 && currentLyrics[newIdx].text) ? currentLyrics[newIdx].text : '';
            if (playCurrentLyricEl) {
                playCurrentLyricEl.textContent = txt;
            }
            if (newIdx === currentLyricIndex) return;
            currentLyricIndex = newIdx;

            // 同步 PiP 小窗歌词
            if (pipWindow) {
                var pipLyricEl = pipWindow.document.getElementById('pip-lyric');
                if (pipLyricEl) pipLyricEl.textContent = txt;
            }

            // 锁屏歌词：开启时用歌词文本覆盖 title，artist 改为 歌名 · 思诺
            if ((settings && settings.lockscreenLyric) === 'on' &&
                typeof navigator !== 'undefined' && navigator.mediaSession && navigator.mediaSession.metadata) {
                try {
                    var meta = navigator.mediaSession.metadata;
                    var idx2 = getCurrentIndex();
                    var songName2 = (idx2 >= 0 && songList[idx2]) ? (songList[idx2].name || songList[idx2].title || '—') : '—';
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: txt || songName2,
                        artist: songName2 + ' · 思诺',
                        album: meta.album,
                        artwork: meta.artwork
                    });
                } catch (e) {}
            }

            if (!lyricsViewOpen) return;

            // 更新高亮（用 dataset.idx 匹配，避免空行跳过导致的 DOM 索引偏移）
            var lines = lyricsScrollEl.querySelectorAll('.lyric-line');
            lines.forEach(function (el) {
                el.classList.toggle('active', parseInt(el.dataset.idx) === newIdx);
            });
            // 调轴模式下不自动滚动
            if (!adjustMode) scrollToActiveLyric(true);
        }

        /** 将当前高亮行滚动到视图中央（略偏上，让视觉中心更舒服） */
        function scrollToActiveLyric(smooth) {
            if (!lyricsScrollEl || currentLyricIndex < 0) return;
            // 用户正在手动滚动时不自动跟随
            if (smooth && userScrollingLyrics) return;
            var active = lyricsScrollEl.querySelector('.lyric-line[data-idx="' + currentLyricIndex + '"]');
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
            // 1. 初始化状态
            currentLyrics = null;
            currentLyricIndex = -1;
            lyricsFirstScrollDone = false;
            userHasLyric = false;
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
                const userLrc = await window.SG_LYRICS.getUserLrc(currentPlayingBvid);
                userHasLyric = !!userLrc;

                const lines = await window.SG_LYRICS.loadLyrics(currentPlayingBvid);
                currentLyrics = (lines && lines.length) ? lines : null;

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

            // 清理可能遗留的悬浮栏
            const existingBar = document.getElementById('adjust-action-bar');
            if (existingBar) existingBar.remove();

            // 1. 顶部提示说明 (带 Icon)
            var hintEl = document.createElement('div');
            hintEl.className = 'adjust-hint';
            hintEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> 播放到合适的时间点，点击对应歌词行即可对齐时间';
            lyricsScrollEl.appendChild(hintEl);

            // 2. 渲染时间轴列表
            adjustLyrics.forEach(function (line, idx) {
                if (!line.text) return;
                var row = document.createElement('div');
                row.className = 'adjust-lyric-row';
                row.dataset.idx = idx;

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
            var min = Math.floor(t / 60);
            var sec = Math.floor(t % 60);
            var cs = Math.round((t - Math.floor(t)) * 100);
            return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
        }

        /** 更新调轴模式下的高亮行（跟随播放进度） */
        function updateAdjustHighlight() {
            if (!adjustMode || !adjustLyrics || !lyricsScrollEl) return;
            var t = bgmAudio.currentTime;
            var newIdx = -1;
            for (var i = adjustLyrics.length - 1; i >= 0; i--) {
                if (t >= adjustLyrics[i].time) { newIdx = i; break; }
            }
            var rows = lyricsScrollEl.querySelectorAll('.adjust-lyric-row');
            rows.forEach(function (row) {
                row.classList.toggle('is-current', parseInt(row.dataset.idx) === newIdx);
            });
        }

        /** 对指定歌词行应用当前进度时间，后续行同步偏移 */
        function applyAdjustTime(idx) {
            if (!adjustLyrics) return;
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
        }

        /** 进入调轴模式 */
        function enterAdjustMode() {
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
            renderAdjustScroll();
        }

        /** 保存调轴结果 */
        function saveAdjustMode() {
            if (!adjustLyrics || !adjustBvid) { cancelAdjustMode(); return; }
            var lrcText = lyricsToLrcText(adjustLyrics);
            window.SG_LYRICS.saveUserLrc(adjustBvid, lrcText).then(function () {
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
                showToast('保存失败，请重试。');
            });
        }

        /** 取消调轴模式 */
        function cancelAdjustMode() {
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
            // 只有 bvid 真正变化（切歌）时才处理调轴退出
            if (adjustMode && currentPlayingBvid !== prevBvid) {
                var confirmed = confirm('正在调轴，是否不保存退出调轴？');
                if (confirmed) {
                    adjustMode = false;
                    adjustLyrics = null;
                    adjustBvid = '';
                    lyricsReloadForCurrentSong();
                } else {
                    // 用户选择取消：保持调轴状态，重新渲染调轴视图
                    adjustBvid = currentPlayingBvid || '';
                    renderAdjustScroll();
                }
            } else if (!adjustMode) {
                lyricsReloadForCurrentSong();
            }
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

            // 开启弹窗与加载提示
            textarea.value = '';
            textarea.placeholder = '正在获取歌词文本...';
            backdrop.dataset.bvid = bvid || '';
            backdrop.classList.add('is-open');
            setTimeout(function () { textarea.focus(); }, 100);

            try {
                // 1. 优先尝试从本地数据库获取用户修改过的歌词
                let finalLrc = await window.SG_LYRICS.getUserLrc(bvid);

                // 2. 最干净的逻辑：如果用户没存过，直接顺藤摸瓜去服务器拉取原始 LRC 文件！
                if (!finalLrc) {
                    try {
                        // 请求歌词映射表 (加时间戳防缓存)
                        const indexRes = await fetch('./lyrics/lyrics.json?_=' + Date.now());
                        if (indexRes.ok) {
                            const indexData = await indexRes.json();
                            const filename = indexData.map && indexData.map[bvid];
                            
                            // 如果在花名册里找到了，直接拉取该文件的纯文本
                            if (filename) {
                                const lrcRes = await fetch('./lyrics/' + encodeURIComponent(filename));
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
                if (finalLrc) {
                    textarea.value = finalLrc;
                } else {
                    textarea.placeholder = '[00:00.00] 暂无系统歌词，请在此输入或导入...';
                }
            } catch (e) {
                console.error("加载歌词失败:", e);
                textarea.placeholder = '加载失败，请重试或直接粘贴。';
            }
        }

        function closeLyricForm() {
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
            // 文件导入
            if (btnImport && fileInput) {
                btnImport.addEventListener('click', function () { fileInput.click(); });
                fileInput.addEventListener('change', function () {
                    var file = this.files && this.files[0];
                    if (!file) return;
                    var reader = new FileReader();
                    reader.onload = function (e) {
                        var textarea = document.getElementById('lyric-form-textarea');
                        if (textarea) textarea.value = e.target.result || '';
                    };
                    reader.readAsText(file, 'UTF-8');
                    this.value = '';
                });
            }
        })();

        // 歌词模块完成所有 patch 后，重新绑定 audio 事件，
        // 确保 timeupdate 触发的是包含歌词高亮的最新 updateProgressDisplay
        bindAudioEvents(bgmAudio);
