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
                overlay.style.background = 'rgba(0, 243, 255, 0.5)';
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
        const DEFAULT_TITLE = '心宜 · Fiona';
        const CURRENT_VERSION = '0.0.4(测)';
        // 如果你绑定了 api.snow-gladys.com，请使用下面第一行
        const API_BASE = 'https://api.snow-gladys.com'; 
        // 如果没绑定成功，暂时用 Worker 原生地址：
        // const API_BASE = 'https://snow-api-proxy.pengyiteng0827.workers.dev'; 

        // --- 1. 获取粉丝数逻辑 ---
        const fanCountElement = document.getElementById('fan-count');
        
        async function fetchFanCount() {
            try {
                const VMID_XINYI = '3537115310721181';
                const response = await fetch(`${API_BASE}/fans?vmid=${VMID_XINYI}`);
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
        const FAV_STORAGE_KEY = 'sg_fav_fiona';
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

        // --- 1.5.2 设置（Cookie）与自定义歌单（Local Storage，心宜独立）---
        const SETTINGS_COOKIE = 'sg_settings_fiona';
        const SETTINGS_MAX_AGE = 365 * 24 * 60 * 60;
        const CUSTOM_STORAGE_KEY = 'sg_custom_songs_fiona';

        function getSettingsFromCookie() {
            try {
                const raw = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(SETTINGS_COOKIE + '='));
                if (!raw) return { showMain: true, showLive: false, showCustom: false, version: null };
                const value = decodeURIComponent((raw.indexOf('=') >= 0 ? raw.substring(raw.indexOf('=') + 1) : '').trim());
                const o = JSON.parse(value || '{}');
                return {
                    showMain: o.showMain !== false,
                    showLive: o.showLive === true,
                    showCustom: !!o.showCustom,
                    version: o.version || null
                };
            } catch (e) { return { showMain: true, showLive: false, showCustom: false, version: null }; }
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
            var favRaw = document.cookie.split(';').map(function (s) { return s.trim(); }).find(function (s) { return s.startsWith('sg_fav_fiona='); });
            var customRaw = document.cookie.split(';').map(function (s) { return s.trim(); }).find(function (s) { return s.startsWith('sg_custom_songs_fiona='); });
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
                console.log('[存储迁移-心宜] 已从 Cookie 迁移至 Local Storage：收藏 ' + favCount + ' 首，自定义歌曲 ' + customCount + ' 首。');
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
            if (focusIndex != null && focusIndex >= 0) {
                const item = playlistListEl.querySelector(`[data-index="${focusIndex}"]`);
                if (item) {
                    item.classList.add('current');
                    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }
            viewPlaylist.classList.add('is-open');
        }

        function closePlaylist() {
            showView(viewPlay.classList.contains('is-active') ? 'play' : 'home');
        }

        function renderPlaylist() {
            if (!playlistListEl) return;
            const query = (playlistSearchEl && playlistSearchEl.value || '').trim().toLowerCase();
            let items = songList.map((s, i) => ({ s, i }));
            if (playlistFilterFavorites) items = items.filter(({ s }) => isFavorite(s.bvid));
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
            }
            playlistListEl.innerHTML = '';
            const total = playlistFilterFavorites ? songList.filter(s => isFavorite(s.bvid)).length : songList.length;
            if (playlistCountEl) playlistCountEl.textContent = query ? items.length + ' / ' + total : total;
            const curBvid = currentPlayingBvid || '';
            items.forEach(({ s, i }) => {
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
                playlistListEl.appendChild(btn);
            });
        }

        function buildSongList() {
            const out = [];
            if (settings.showMain) mainList.forEach(s => out.push({ name: s.name || s.title, bvid: s.bvid || '', isCustom: false, isLive: false }));
            if (settings.showLive) liveList.forEach(s => out.push({ name: s.name || s.title, bvid: s.bvid || '', isCustom: false, isLive: true }));
            if (settings.showCustom) customList.forEach(s => out.push({ name: s.name, bvid: s.bvid || '', isCustom: true, isLive: false }));
            songList = out;
        }

        async function loadSongs() {
            const fallbackList = [
  {
    "name": "Enchanted",
    "bvid": "BV1ZTZ7B9ERQ"
  },
  {
    "name": "麦恩莉",
    "bvid": "BV1kfZjBFE29"
  },
  {
    "name": "今天你要嫁给我",
    "bvid": "BV1wFZ7B8Exe"
  },
  {
    "name": "十七岁",
    "bvid": "BV1qHFLzWEdx"
  },
  {
    "name": "四季",
    "bvid": "BV1BHFLzWEbg"
  },
  {
    "name": "K歌之王",
    "bvid": "BV1qpFLzXEcj"
  },
  {
    "name": "My Love",
    "bvid": "BV17pFLzXEEn"
  },
  {
    "name": "Bésame Mucho",
    "bvid": "BV17pFLzXEHx"
  },
  {
    "name": "la vie en rose",
    "bvid": "BV1jpFLzXEZo"
  },
  {
    "name": "Take Me To Your Heart",
    "bvid": "BV1FEFLz4EwH"
  },
  {
    "name": "开不了口",
    "bvid": "BV1t16tBoEn3"
  },
  {
    "name": "人质",
    "bvid": "BV1yP62BqEzM"
  },
  {
    "name": "Back to December",
    "bvid": "BV1pK6GBuEXo"
  },
  {
    "name": "下一站天后",
    "bvid": "BV1pK6GBuE6z"
  },
  {
    "name": "雪落下的声音",
    "bvid": "BV1CK6GBMEeE"
  },
  {
    "name": "冬天里的一把火",
    "bvid": "BV1rT6GBqEoi"
  },
  {
    "name": "不如跳舞",
    "bvid": "BV1fhzxBvEVQ"
  },
  {
    "name": "小步舞曲",
    "bvid": "BV1GokEBLEJA"
  },
  {
    "name": "偿还",
    "bvid": "BV1cJkJB8EHe"
  },
  {
    "name": "遇见你的时候所有星星都落在我头上",
    "bvid": "BV1H9k4BJEBG"
  }
];
            try {
                const res = await fetch('./songs_fiona.json');
                if (res.ok) {
                    const data = await res.json();
                    mainList = Array.isArray(data) && data.length > 0 ? data : fallbackList;
                } else mainList = fallbackList;
            } catch (e) {
                console.warn('Fiona 精选歌单加载失败，使用默认列表:', e);
                mainList = fallbackList;
            }
            try {
                const resLive = await fetch('./songs_fiona_live.json');
                if (resLive.ok) {
                    const data = await resLive.json();
                    liveList = Array.isArray(data) ? data : [];
                } else liveList = [];
            } catch (e) { liveList = []; }
            customList = getCustomFromStorage();
            buildSongList();
            renderPlaylist();
        }

        function syncSettingsToggles() {
            const tMain = document.getElementById('toggle-show-main');
            const tLive = document.getElementById('toggle-show-live');
            const tCustom = document.getElementById('toggle-show-custom');
            if (tMain) tMain.classList.toggle('is-on', settings.showMain);
            if (tLive) tLive.classList.toggle('is-on', settings.showLive);
            if (tCustom) tCustom.classList.toggle('is-on', settings.showCustom);
        }

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
            a.download = 'custom_songs_xinyi.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

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

        function renderCustomManageList(query) {
            const listEl = document.getElementById('custom-manage-list');
            if (!listEl) return;
            const q = (query || '').trim().toLowerCase();
            const items = customList.map((item, idx) => ({ item, idx })).filter(function (x) {
                if (!q) return true;
                return (x.item.name || '').toLowerCase().includes(q) || (x.item.bvid || '').toLowerCase().includes(q);
            });
            listEl.innerHTML = '';
            items.forEach(function (x) {
                const row = document.createElement('div');
                row.className = 'custom-manage-item';
                row.innerHTML = '<span class="name" title="' + (x.item.name || '').replace(/"/g, '&quot;') + '"></span><span class="bvid"></span><button type="button" class="btn-edit">修改</button><button type="button" class="btn-del">删除</button>';
                row.querySelector('.name').textContent = x.item.name || '—';
                row.querySelector('.bvid').textContent = x.item.bvid || '';
                row.querySelector('.btn-edit').addEventListener('click', function (e) { e.stopPropagation(); closeCustomManage(); openCustomForm(x.idx); });
                row.querySelector('.btn-del').addEventListener('click', function (e) {
                    e.stopPropagation();
                    customList.splice(x.idx, 1);
                    saveCustomToStorage(customList);
                    buildSongList();
                    renderPlaylist();
                    renderCustomManageList(document.getElementById('custom-manage-search').value);
                    if (customList.length === 0) { closeCustomManage(); renderCustomSectionInSettings(); }
                });
                listEl.appendChild(row);
            });
        }

        function openCustomForm(editIndex) {
            const backdrop = document.getElementById('custom-form-backdrop');
            const title = document.getElementById('custom-form-title');
            const nameIn = document.getElementById('custom-form-name');
            const bvidIn = document.getElementById('custom-form-bvid');
            if (editIndex != null && editIndex >= 0 && customList[editIndex]) {
                title.textContent = '修改自定义歌曲';
                nameIn.value = customList[editIndex].name || '';
                bvidIn.value = customList[editIndex].bvid || '';
                nameIn.dataset.editIndex = String(editIndex);
            } else {
                title.textContent = '添加自定义歌曲';
                nameIn.value = '';
                bvidIn.value = '';
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
            const name = (nameIn.value || '').trim();
            const bvid = (bvidIn.value || '').trim();
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

            document.getElementById('custom-manage-backdrop').addEventListener('click', function (e) { if (e.target.id === 'custom-manage-backdrop') closeCustomManage(); });
            document.getElementById('custom-manage-panel').addEventListener('click', function (e) { e.stopPropagation(); });
            var manageSearchEl = document.getElementById('custom-manage-search');
            if (manageSearchEl) manageSearchEl.addEventListener('input', function () { renderCustomManageList(this.value); });

            document.getElementById('custom-form-cancel').addEventListener('click', closeCustomForm);
            document.getElementById('custom-form-backdrop').addEventListener('click', function (e) { if (e.target.id === 'custom-form-backdrop') closeCustomForm(); });
            document.getElementById('custom-form-submit').addEventListener('click', submitCustomForm);
            document.getElementById('custom-form-box').addEventListener('click', function (e) { e.stopPropagation(); });
        })();

        document.getElementById('btn-open-playlist').addEventListener('click', () => openPlaylist());
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

        // 封装事件监听绑定逻辑，因为每次"偷梁换柱"后都需要重新绑定
        function bindAudioEvents(audioObj) {
            audioObj.removeEventListener('timeupdate', updateProgressDisplay);
            audioObj.removeEventListener('loadedmetadata', updateProgressDisplay);
            audioObj.removeEventListener('ended', handleAudioEnded);

            audioObj.addEventListener('timeupdate', updateProgressDisplay);
            audioObj.addEventListener('loadedmetadata', updateProgressDisplay);
            audioObj.addEventListener('ended', handleAudioEnded);
        }

        // 单独抽离 ended 处理函数，方便绑定
        function handleAudioEnded() {
            updateProgressDisplay();
            stopVisuals();
            updatePlayPauseIcon();
            playNextByMode();
        }

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

        /** 只调用一次 resolvehtml API（不处理 403），返回 { url } 或 null */
        function fetchResolveHtml(bvid) {
            var apiUrl = API_BASE + '/resolvehtml?bvid=' + encodeURIComponent(bvid);
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
            var apiUrl = API_BASE + '/resolve?bvid=' + encodeURIComponent(bvid);
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

        const MODE_LABELS = { list: '列表循环', single: '单曲循环', random: '随机播放', favorites: '播放收藏' };
        function setPlayMode(mode) {
            playMode = mode;
            if (mode !== 'random') nextRandomBvid = null;
            if (btnModeCycle) {
                btnModeCycle.textContent = MODE_LABELS[mode] || mode;
                btnModeCycle.title = mode === 'favorites' ? '收藏列表循环' : mode === 'list' ? '列表循环' : mode === 'single' ? '单曲循环' : '随机播放';
            }
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
                document.title = name + ' · 心宜';
            } else {
                document.title = DEFAULT_TITLE;
            }
        }

        // 播放函数（预加载缓存 + getLoadableRealUrl 探测 403 重试，失败则弹窗并自动下一首）
        async function playMusic(bvid) {
            if (!bvid) return;
            preloadScheduledForBvid = null;

            let usePreloadObject = false;
            var initialUrl = null;

            if (preloadCache && (preloadCache.bvid || '').toUpperCase() === (bvid || '').toUpperCase()) {
                initialUrl = preloadCache.url;
                preloadCache = null;
                usePreloadObject = true;
            }
            clearPreload();

            var realUrl = await getLoadableRealUrl(bvid, initialUrl);
            if (!realUrl) {
                handlePlayError(bvid);
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
                oldAudio.src = "";
                oldAudio.load();
                oldAudio = null;
            } else {
                bgmAudio.src = realUrl;
                bgmAudio.volume = 0.5;
            }

            updateProgressDisplay();
            updatePlaySongName();

        try {
                await bgmAudio.play();
                startVisuals(bvid);
                updatePlayPauseIcon();
            } catch (err) {
                console.error("播放失败，尝试救急处理:", err);
                if (realUrl === initialUrl) {
                    console.log("预加载链接似乎失效，尝试重新获取链接...");
                    var retryUrl = await getLoadableRealUrl(bvid, null);
                    if (retryUrl) {
                        playMusic(bvid);
                        return;
                    }
                }
                handlePlayError(bvid);
                updatePlayPauseIcon();
            }

            await bgmAudio.play();
            startVisuals(bvid);
            updatePlayPauseIcon();
        }

        function handlePlayError(bvid) {
            var songName = getSongNameByBvid(bvid);
            // 停止视觉旋转
            stopVisuals(); 
            alert('对不起小伙伴，神秘阿B力量暂时拒绝了歌曲《' + songName + '》的访问，之后可再重试喵。');
            // 自动切下一首
            // playNextByMode();
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

        // 播放条与时间（timeupdate/loadedmetadata/ended 已由 bindAudioEvents 统一绑定）
        bindAudioEvents(bgmAudio);

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
        setPlayMode('list');
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

