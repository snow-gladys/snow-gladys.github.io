        (function() {
            var navLink = document.querySelector('.nav-emoji-link');
            if (!navLink) return;
            navLink.addEventListener('click', function(e) {
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
                requestAnimationFrame(function() {
                    overlay.style.clipPath = 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)';
                });
                overlay.addEventListener('transitionend', function() {
                    window.location.href = navLink.href;
                });
            });
        })();

        // --- 0. 配置中心 ---
        const DEFAULT_TITLE = '思诺 · Gladys';
        const CURRENT_VERSION = '0.0.7(测)';

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

        // --- 1.5.2 设置（Cookie）与自定义歌单（Local Storage）---
        const SETTINGS_COOKIE = 'sg_settings';
        const SETTINGS_MAX_AGE = 365 * 24 * 60 * 60;
        const CUSTOM_STORAGE_KEY = 'sg_custom_songs';

        function getSettingsFromCookie() {
            const fallback = { showMain: true, showLive: false, showCustom: false, version: null, audioMode: 'medium', mediaSession: 'on', pipSetting: 'off', lockscreenLyric: 'off' };
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
                    lockscreenLyric: o.lockscreenLyric === 'on' ? 'on' : 'off'
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
            const nameEl = document.createElement('span');
            nameEl.className = 'playlist-item-name';
            nameEl.textContent = s.name || s.title || '';
            btn.appendChild(nameEl);
            const badges = document.createElement('span');
            badges.className = 'playlist-item-badges';
            if (s.isCustom) {
                const userIcon = document.createElement('span');
                userIcon.className = 'playlist-item-user-icon';
                userIcon.setAttribute('aria-label', '用户');
                userIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="100%" height="100%"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
                badges.appendChild(userIcon);
            }
            if (s.isLive) {
                const liveTag = document.createElement('span');
                liveTag.className = 'playlist-item-live-tag';
                liveTag.textContent = 'Live';
                badges.appendChild(liveTag);
            }
            btn.appendChild(badges);
            const starWrap = document.createElement('span');
            starWrap.className = 'playlist-item-star-wrap';
            if (isFavorite(s.bvid)) {
                const starEl = document.createElement('span');
                starEl.className = 'playlist-item-star';
                starEl.setAttribute('aria-hidden', 'true');
                starEl.textContent = '★';
                starWrap.appendChild(starEl);
            }
            btn.appendChild(starWrap);
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

        function syncMediaSessionButtons() {
            const mode = (settings && settings.mediaSession) || 'on';
            document.querySelectorAll('.btn-mediasession').forEach(function (btn) {
                btn.classList.toggle('is-active', btn.getAttribute('data-mode') === mode);
            });
        }

        function syncPipSettingButtons() {
            const mode = (settings && settings.pipSetting) || 'off';
            document.querySelectorAll('.btn-pip-setting').forEach(function (btn) {
                btn.classList.toggle('is-active', btn.getAttribute('data-mode') === mode);
            });
            // 按设置显隐小窗按钮（同时需要浏览器支持 API）
            const pipBtn = document.getElementById('btn-pip');
            if (pipBtn) {
                const supported = 'documentPictureInPicture' in window;
                pipBtn.style.display = (supported && mode === 'on') ? '' : 'none';
            }
        }

        function syncLockscreenLyricButtons() {
            const mode = (settings && settings.lockscreenLyric) || 'off';
            document.querySelectorAll('.btn-lockscreen-lyric').forEach(function (btn) {
                btn.classList.toggle('is-active', btn.getAttribute('data-mode') === mode);
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

            // LocalStorage：以 5 MB 为预估上限显示百分比
            var lsBytes = 0;
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    lsBytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
                }
            } catch (e) {}
            var LS_QUOTA = 5 * 1024 * 1024;
            var lsPct = Math.min((lsBytes / LS_QUOTA * 100), 100).toFixed(1);
            lines.push('LocalStorage：' + formatBytes(lsBytes) + ' / 5 MB (' + lsPct + '%)');

            // IndexedDB 用户歌词
            if (window.SG_LYRICS && window.SG_LYRICS.supported) {
                try {
                    var idbBytes = await window.SG_LYRICS.estimateIdbBytes();
                    lines.push('歌词 IndexedDB：' + formatBytes(idbBytes));
                } catch (e) {}
            }

            // storage.estimate()：浏览器整体估算
            if (navigator.storage && navigator.storage.estimate) {
                try {
                    var est = await navigator.storage.estimate();
                    var used = est.usage || 0;
                    var quota = est.quota || 0;
                    if (used > 0) {
                        var pct = quota > 0 ? ((used / quota) * 100).toFixed(1) : null;
                        lines.push('浏览器估算其他已用：' + formatBytes(used) +
                            (pct !== null ? ' / ' + formatBytes(quota) + ' (' + pct + '%)' : ''));
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
                btn.classList.toggle('is-active', m === mode);
            });
        }

        /** 设置页「自定义歌曲」区：无歌曲时只显示添加 + 导入/导出；有歌曲时 添加/管理 + 导入/导出 并排 */
        function renderCustomSectionInSettings() {
            const container = document.getElementById('custom-section-buttons');
            if (!container) return;
            if (customList.length === 0) {
                container.innerHTML =
                    '<div class="custom-buttons-row">' +
                        '<button type="button" class="btn-add-custom" id="btn-add-custom">添加自定义歌曲</button>' +
                    '</div>' +
                    '<div class="custom-buttons-row">' +
                        '<button type="button" class="btn-add-custom btn-export-custom" id="btn-export-custom">导出自定义歌单</button>' +
                        '<button type="button" class="btn-add-custom btn-import-custom" id="btn-import-custom">导入自定义歌单</button>' +
                    '</div>' +
                    '<input type="file" id="input-import-custom" accept=".txt" style="display:none">';
            } else {
                container.innerHTML =
                    '<div class="custom-buttons-row">' +
                        '<button type="button" class="btn-add-custom" id="btn-add-custom">添加自定义歌曲</button>' +
                        '<button type="button" class="btn-manage-custom" id="btn-manage-custom">管理自定义歌曲</button>' +
                    '</div>' +
                    '<div class="custom-buttons-row">' +
                        '<button type="button" class="btn-add-custom btn-export-custom" id="btn-export-custom">导出自定义歌单</button>' +
                        '<button type="button" class="btn-add-custom btn-import-custom" id="btn-import-custom">导入自定义歌单</button>' +
                    '</div>' +
                    '<input type="file" id="input-import-custom" accept=".txt" style="display:none">';
            }

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
                if (!bgmAudio.paused) {
                    bgmAudio.pause();
                    stopVisuals();
                    updatePlayPauseIcon();
                }
                alert('定时关闭时间已到，播放已自动暂停。');
            }, ms);

            sleepTimerIntervalId = setInterval(function () {
                if (!sleepTimerDeadline) {
                    clearSleepTimerJobs();
                    updateSleepTimerLabel();
                    return;
                }
                if (sleepTimerDeadline - Date.now() <= 0) {
                    clearSleepTimerJobs();
                    sleepTimerDeadline = null;
                    updateSleepTimerLabel();
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
            const btnChangelog = document.getElementById('btn-changelog');
            if (btnChangelog) btnChangelog.classList.remove('has-new');
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
            function openSettings() {
                settings = getSettingsFromCookie();
                syncSettingsToggles();
                renderCustomSectionInSettings();
                syncQualityButtons();
                syncMediaSessionButtons();
                syncPipSettingButtons();
                syncLockscreenLyricButtons();
                refreshStorageUsageDisplay();
                modalBackdrop.classList.add('is-open');

                if (hasNewVersionFlag) {
                    const btnHome = document.getElementById('btn-settings-home');
                    const btnPlay = document.getElementById('btn-settings-play');
                    if (btnHome) btnHome.classList.remove('has-new');
                    if (btnPlay) btnPlay.classList.remove('has-new');
                    const btnChangelog = document.getElementById('btn-changelog');
                    if (btnChangelog) btnChangelog.classList.add('has-new');
                }
            }
            function closeSettings() { modalBackdrop.classList.remove('is-open'); }
            document.getElementById('btn-settings-home').addEventListener('click', openSettings);
            document.getElementById('btn-settings-play').addEventListener('click', openSettings);
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
            var manageSearchEl = document.getElementById('custom-manage-search');
            if (manageSearchEl) manageSearchEl.addEventListener('input', function () { renderCustomManageList(this.value); });

            document.getElementById('custom-form-cancel').addEventListener('click', closeCustomForm);
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

        document.getElementById('btn-open-playlist').addEventListener('click', () => openPlaylist(getCurrentIndex()));
        document.getElementById('btn-play-random').addEventListener('click', () => {
            if (!songList.length) return;
            const i = getRandomIndex(songList.length, -1);
            playMusic(songList[i].bvid || '');
            showView('play');
        });
        document.getElementById('btn-play-favorites').addEventListener('click', () => {
            const favList = getFavoritesList();
            if (!favList.length) return;
            setPlayMode('favorites');
            playMusic(favList[0].bvid || '');
            showView('play');
        });
        playlistBackdrop.addEventListener('click', closePlaylist);
        const btnClosePlaylist = document.getElementById('btn-close-playlist');
        if (btnClosePlaylist) btnClosePlaylist.addEventListener('click', closePlaylist);
        document.getElementById('btn-open-catalog').addEventListener('click', () => openPlaylist(getCurrentIndex()));
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
        let globalPreloadAudio = new Audio(); // 全局预加载对象

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
        let currentPlayingBvid = '';  // 当前播放的 bvid

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

        function formatTime(sec) {
            if (sec === undefined || sec === null || !isFinite(sec) || isNaN(sec)) return '0:00';
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            return m + ':' + (s < 10 ? '0' : '') + s;
        }

        function updateProgressDisplay() {
            const t = bgmAudio.currentTime;
            const d = bgmAudio.duration;
            timeCurrentEl.textContent = formatTime(t);
            if (isFinite(d) && d > 0) {
                timeTotalEl.textContent = formatTime(d);
                const p = (t / d) * 100;
                progressBarEl.value = p;
                progressBarEl.style.setProperty('--progress', p + '%');
                onTimeUpdateForPreload();
            } else {
                timeTotalEl.textContent = '0:00';
                progressBarEl.value = 0;
                progressBarEl.style.setProperty('--progress', '0%');
            }
        }

        const MODE_TITLES = { list: '列表循环', single: '单曲循环', random: '随机播放', favorites: '收藏列表循环' };
        function setPlayMode(mode) {
            playMode = mode;
            if (mode !== 'random') nextRandomBvid = null;
            if (btnModeCycle) {
                btnModeCycle.classList.remove('is-mode-list', 'is-mode-single', 'is-mode-random', 'is-mode-favorites');
                btnModeCycle.classList.add('is-mode-' + (mode || 'list'));
                btnModeCycle.title = MODE_TITLES[mode] || MODE_TITLES.list;
            }
            try { localStorage.setItem(PLAY_MODE_STORAGE_KEY, mode || 'list'); } catch (e) {}
        }

        /** 收藏列表（保持 songList 顺序） */
        function getFavoritesList() {
            return songList.filter(s => isFavorite(s.bvid));
        }

        /** 当前模式下的可播列表 */
        function getEffectiveList() {
            if (playMode === 'favorites') return getFavoritesList();
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
        }

        function stopVisuals() {
            const deg = getRecordRotationDeg(characterImg);
            characterImg.classList.remove('is-playing');
            characterImg.style.setProperty('transform', 'rotate(' + deg + 'deg)');
        }

        // 播放条与时间（timeupdate/loadedmetadata/ended 已由 bindAudioEvents 统一绑定，此处不再重复）

        // 拖动进度条跳转
        if (progressBarEl) progressBarEl.addEventListener('input', () => {
            const d = bgmAudio.duration;
            if (isFinite(d) && d > 0) {
                const p = parseFloat(progressBarEl.value) / 100;
                bgmAudio.currentTime = p * d;
                progressBarEl.style.setProperty('--progress', progressBarEl.value + '%');
            }
        });

        // 播放/暂停按钮
        btnPlayPause.addEventListener('click', () => {
            if (bgmAudio.paused) {
                if (bgmAudio.src) {
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
            return favoritesSet.size ? ['list', 'single', 'random', 'favorites'] : ['list', 'single', 'random'];
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
            if (['list', 'single', 'random', 'favorites'].indexOf(saved) < 0) saved = 'list';
            if (saved === 'favorites' && favoritesSet.size === 0) saved = 'list';
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
                '</div>' +
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
            if (nameEl) nameEl.textContent = getSongName();
            if (lyricEl) {
                var lyricTxt = (currentLyrics && currentLyricIndex >= 0 && currentLyrics[currentLyricIndex])
                    ? (currentLyrics[currentLyricIndex].text || '') : '';
                lyricEl.textContent = lyricTxt;
            }
            if (playBtn) playBtn.classList.toggle('is-playing', !bgmAudio.paused);
            const t = bgmAudio.currentTime;
            const d = bgmAudio.duration;
            if (curEl) curEl.textContent = formatTime(t);
            if (isFinite(d) && d > 0) {
                if (totEl) totEl.textContent = formatTime(d);
                if (barEl) { barEl.value = (t / d) * 100; barEl.style.setProperty('--progress', barEl.value + '%'); }
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
                    if (btnPip) btnPip.classList.remove('is-pip-open');
                });

                if (btnPip) btnPip.classList.add('is-pip-open');
                syncPipUI();

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
        (function initLyricsSongNameBar() {
            var bar = document.createElement('div');
            bar.className = 'lyrics-song-name-bar';
            bar.id = 'lyrics-song-name-bar';
            viewPlay.appendChild(bar);
            lyricsSongNameBar = bar;
        })();

        /** 切换歌词全屏视图 */
        function toggleLyricsView(forceOpen) {
            lyricsViewOpen = forceOpen !== undefined ? forceOpen : !lyricsViewOpen;
            viewPlay.classList.toggle('is-lyrics-open', lyricsViewOpen);
            if (btnLyrics) btnLyrics.classList.toggle('is-lyrics-open', lyricsViewOpen);
            // 歌词模式下同步隐藏唱片（通过 character-layer 透明度）
            var charLayer = document.querySelector('.character-layer');
            if (charLayer) {
                charLayer.style.opacity = lyricsViewOpen ? '0' : '';
                charLayer.style.pointerEvents = lyricsViewOpen ? 'none' : '';
            }
            if (lyricsViewOpen) renderLyricsScroll();
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

            if (!currentLyrics || currentLyrics.length === 0) {
                // 无歌词
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
                    addBtn.textContent = '添加歌词';
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

            // 底部操作按钮区
            var actionArea = document.createElement('div');
            actionArea.className = 'lyrics-action-area';

            if (window.SG_LYRICS && window.SG_LYRICS.supported) {
                if (userHasLyric) {
                    // 用户自定义歌词：删除、编辑、导出、调轴
                    var delLyricBtn = document.createElement('button');
                    delLyricBtn.type = 'button';
                    delLyricBtn.className = 'btn-lyric-action';
                    delLyricBtn.textContent = '删除歌词';
                    delLyricBtn.addEventListener('click', function () {
                        if (!confirm('确定删除当前歌曲的自定义歌词吗？')) return;
                        window.SG_LYRICS.deleteUserLrc(currentPlayingBvid || '').then(function () {
                            userHasLyric = false;
                            lyricsReloadForCurrentSong();
                        }).catch(function () {
                            showToast('删除歌词失败，请重试。');
                        });
                    });
                    actionArea.appendChild(delLyricBtn);

                    var editLyricBtn = document.createElement('button');
                    editLyricBtn.type = 'button';
                    editLyricBtn.className = 'btn-lyric-action';
                    editLyricBtn.textContent = '编辑歌词';
                    editLyricBtn.addEventListener('click', function () {
                        openLyricForm(currentPlayingBvid || '', '');
                    });
                    actionArea.appendChild(editLyricBtn);

                    var exportBtn = document.createElement('button');
                    exportBtn.type = 'button';
                    exportBtn.className = 'btn-lyric-action';
                    exportBtn.textContent = '导出歌词';
                    exportBtn.addEventListener('click', exportCurrentLyrics);
                    actionArea.appendChild(exportBtn);

                    var adjustBtn = document.createElement('button');
                    adjustBtn.type = 'button';
                    adjustBtn.className = 'btn-lyric-action';
                    adjustBtn.textContent = '简易调轴';
                    adjustBtn.addEventListener('click', function () {
                        enterAdjustMode();
                    });
                    actionArea.appendChild(adjustBtn);
                } else {
                    // 内置歌词：添加/替换、导出、调轴
                    var addOverrideBtn = document.createElement('button');
                    addOverrideBtn.type = 'button';
                    addOverrideBtn.className = 'btn-lyric-action';
                    addOverrideBtn.textContent = '添加/替换歌词';
                    addOverrideBtn.addEventListener('click', function () {
                        openLyricForm(currentPlayingBvid || '', '');
                    });
                    actionArea.appendChild(addOverrideBtn);

                    var exportBtn2 = document.createElement('button');
                    exportBtn2.type = 'button';
                    exportBtn2.className = 'btn-lyric-action';
                    exportBtn2.textContent = '导出歌词';
                    exportBtn2.addEventListener('click', exportCurrentLyrics);
                    actionArea.appendChild(exportBtn2);

                    var adjustBtn2 = document.createElement('button');
                    adjustBtn2.type = 'button';
                    adjustBtn2.className = 'btn-lyric-action';
                    adjustBtn2.textContent = '简易调轴';
                    adjustBtn2.addEventListener('click', function () {
                        enterAdjustMode();
                    });
                    actionArea.appendChild(adjustBtn2);
                }
            }

            lyricsScrollEl.appendChild(actionArea);

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

        /** 将当前高亮行滚动到视图中央 */
        function scrollToActiveLyric(smooth) {
            if (!lyricsScrollEl || currentLyricIndex < 0) return;
            // 用户正在手动滚动时不自动跟随
            if (smooth && userScrollingLyrics) return;
            var active = lyricsScrollEl.querySelector('.lyric-line[data-idx="' + currentLyricIndex + '"]');
            if (!active) return;
            var containerH = lyricsScrollEl.clientHeight;
            var targetTop = active.offsetTop - containerH / 2 + active.clientHeight / 2;
            lyricsScrollEl.scrollTo({ top: targetTop, behavior: smooth ? 'smooth' : 'auto' });
        }

        /** 为当前歌曲加载并刷新歌词 */
        function lyricsReloadForCurrentSong() {
            currentLyrics = null;
            currentLyricIndex = -1;
            userHasLyric = false;
            if (playCurrentLyricEl) playCurrentLyricEl.textContent = '';
            if (!currentPlayingBvid || !window.SG_LYRICS) {
                if (lyricsViewOpen) renderLyricsScroll();
                return;
            }
            // 先判断有无用户歌词（决定是否显示删除按钮）
            window.SG_LYRICS.getUserLrc(currentPlayingBvid).then(function (userLrc) {
                userHasLyric = !!userLrc;
                return window.SG_LYRICS.loadLyrics(currentPlayingBvid);
            }).then(function (lines) {
                currentLyrics = lines && lines.length ? lines : null;
                currentLyricIndex = -1;
                if (lyricsViewOpen) renderLyricsScroll();
            }).catch(function () {
                currentLyrics = null;
                if (lyricsViewOpen) renderLyricsScroll();
            });
        }

        // ── 简易调轴功能 ──────────────────────────────────────────────

        /** 渲染调轴模式下的歌词列表 */
        function renderAdjustScroll() {
            if (!lyricsScrollEl || !adjustLyrics) return;
            lyricsScrollEl.innerHTML = '';

            // 调轴说明
            var hintEl = document.createElement('div');
            hintEl.className = 'adjust-hint';
            hintEl.textContent = '播放到合适时间点，点击对应歌词行设置时间';
            lyricsScrollEl.appendChild(hintEl);

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

            // 调轴底部按钮
            var adjustActionArea = document.createElement('div');
            adjustActionArea.className = 'lyrics-action-area';

            var saveAdjBtn = document.createElement('button');
            saveAdjBtn.type = 'button';
            saveAdjBtn.className = 'btn-lyric-action btn-lyric-action-primary';
            saveAdjBtn.textContent = '保存调轴';
            saveAdjBtn.addEventListener('click', saveAdjustMode);
            adjustActionArea.appendChild(saveAdjBtn);

            var cancelAdjBtn = document.createElement('button');
            cancelAdjBtn.type = 'button';
            cancelAdjBtn.className = 'btn-lyric-action';
            cancelAdjBtn.textContent = '取消调轴';
            cancelAdjBtn.addEventListener('click', cancelAdjustMode);
            adjustActionArea.appendChild(cancelAdjBtn);

            lyricsScrollEl.appendChild(adjustActionArea);

            // 更新调轴行高亮
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
                showToast('调轴已保存。');
                adjustMode = false;
                adjustLyrics = null;
                adjustBvid = '';
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
        function openLyricForm(bvid, songName) {
            if (!window.SG_LYRICS || !window.SG_LYRICS.supported) {
                showToast('当前浏览器不支持 IndexedDB，无法添加自定义歌词。');
                return;
            }
            var backdrop = document.getElementById('lyric-form-backdrop');
            var titleEl = document.getElementById('lyric-form-title');
            var textarea = document.getElementById('lyric-form-textarea');
            if (!backdrop || !textarea) return;
            if (titleEl) titleEl.textContent = '歌词 · ' + (songName || bvid || '');
            textarea.value = '';
            textarea.placeholder = '[00:00.00] 第一行歌词\n[00:05.00] 第二行歌词';
            // 回填已有歌词
            window.SG_LYRICS.getUserLrc(bvid).then(function (lrc) {
                textarea.value = lrc || '';
            });
            backdrop.dataset.bvid = bvid || '';
            backdrop.classList.add('is-open');
            setTimeout(function () { textarea.focus(); }, 100);
        }

        function closeLyricForm() {
            var backdrop = document.getElementById('lyric-form-backdrop');
            if (backdrop) backdrop.classList.remove('is-open');
        }

        function submitLyricForm() {
            var backdrop = document.getElementById('lyric-form-backdrop');
            var textarea = document.getElementById('lyric-form-textarea');
            if (!backdrop || !textarea) return;
            var bvid = backdrop.dataset.bvid || '';
            var lrcText = (textarea.value || '').trim();
            if (!bvid) { closeLyricForm(); return; }
            if (!lrcText) {
                // 空内容 = 删除
                if (!confirm('歌词内容为空，是否删除该歌曲的自定义歌词？')) return;
                window.SG_LYRICS.deleteUserLrc(bvid).then(function () {
                    showToast('自定义歌词已删除。');
                    if (currentPlayingBvid && currentPlayingBvid === bvid) {
                        lyricsReloadForCurrentSong();
                    }
                    closeLyricForm();
                });
                return;
            }
            // 简单格式校验：至少包含一个时间标签
            if (!/\[\d{1,3}:\d{2}/.test(lrcText)) {
                showToast('格式有误，LRC 歌词需包含时间标签，如 [00:05.00]');
                return;
            }
            window.SG_LYRICS.saveUserLrc(bvid, lrcText).then(function () {
                showToast('歌词已保存。');
                if (currentPlayingBvid && currentPlayingBvid === bvid) {
                    lyricsReloadForCurrentSong();
                }
                closeLyricForm();
                // 刷新管理列表中的歌词按钮状态
                var listEl = document.getElementById('custom-manage-list');
                if (listEl) renderCustomManageList(document.getElementById('custom-manage-search') ? document.getElementById('custom-manage-search').value : '');
            }).catch(function () {
                showToast('保存歌词失败，请重试。');
            });
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
