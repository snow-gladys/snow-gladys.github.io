/* 歌单浏览与实际播放范围分别记录：浏览、改名或换装都不会打断当前歌曲。 */
let lastImportedPlaylist = '', editedPersonalPlaylist = '', pickerPersonalSong = null;
let addingPersonalPlaylist = '', selectedPersonalSongs = new Set(), personalAddLimit = 60;
let collectionIndexRevision = -1, collectionSongIndex = new Map(), collectionSongsCache = new Map();

// 歌单内容只在数据版本变化时复制一次，避免每次打开菜单都解析整份歌库。
let personalCollectionRevision = -1, personalCollectionIndex = new Map();
function getPersonalCollections() {
    if (personalCollectionRevision !== personalLibrary.revision) {
        personalCollectionIndex = new Map(personalLibrary.list().map(list => [list.id, list]));
        personalCollectionRevision = personalLibrary.revision;
    }
    return Array.from(personalCollectionIndex.values());
}
function getPersonalCollection(id) { getPersonalCollections(); return personalCollectionIndex.get(id) || null; }

function getCollection(id) {
    if (id === 'smart-favorites') return { id, name: '我喜欢', songs: getFavoritesList(), smart: true };
    if (id === 'smart-downloaded') return { id, name: '本地缓存', songs: getDownloadedList(), smart: true };
    return catalogPlaylists.find(list => list.id === id) || getPersonalCollection(id);
}
function getCollectionSongs(id) {
    if (collectionIndexRevision !== playlistRevision) {
        collectionSongIndex = new Map(songList.map(song => [song.bvid.toUpperCase(), song]));
        collectionSongsCache.clear();
        collectionIndexRevision = playlistRevision;
    }
    if (!id.startsWith('smart-') && collectionSongsCache.has(id)) return collectionSongsCache.get(id);
    const list = getCollection(id);
    if (!list) return [];
    const values = list.songs.map(song => collectionSongIndex.get(song.bvid.toUpperCase()) || song);
    if (!id.startsWith('smart-')) collectionSongsCache.set(id, values);
    return values;
}
function getPlaybackPlaylistName() { const list = getCollection(playbackPlaylistId); return list ? list.name : ''; }
function validatePlaybackPlaylist() {
    if (playbackPlaylistId && !getCollection(playbackPlaylistId)) {
        if (!catalogPlaylists.length && playbackPlaylistId.startsWith('builtin-')) return;
        setPlaybackPlaylist('');
    }
}
function setPlaybackPlaylist(id) {
    const next = id && getCollection(id) ? id : '';
    if (playbackPlaylistId === next) return;
    playbackPlaylistId = next;
    invalidateNextPlayback(); listeningLibrary.leaveQueue();
    try { localStorage.setItem('sg_playback_playlist', next); } catch (_) { showToast('播放范围本次已应用，浏览器暂时无法保存。'); }
    setPlayScope(next === 'smart-downloaded' ? 'downloaded' : 'all');
}
function syncCollections() {
    buildSongList();
    validatePlaybackPlaylist();
    if (browsedPlaylistId && !getCollection(browsedPlaylistId)) { browsedPlaylistId = ''; playlistTab = 'collections'; }
    playlistRenderKey = '';
    if (playbackPlaylistId) invalidateNextPlayback();
    if (viewPlaylist.classList.contains('is-open')) renderPlaylist();
    syncPlaybackOptions(); syncCollectionToolbar();
}
function openCollection(id) {
    if (!getCollection(id)) return;
    playlistFilterFavorites = false;
    playlistFilterBtn.classList.remove('active'); playlistFilterBtn.title = '只看收藏';
    browsedPlaylistId = id; playlistTab = 'songs'; playlistRenderKey = '';
    openPlaylist(undefined, 'songs'); playlistListEl.scrollTop = 0;
}
function syncCollectionToolbar() {
    const overview = playlistTab === 'collections', detail = playlistTab === 'songs' && !!browsedPlaylistId;
    document.getElementById('collection-tools').hidden = !detail;
    document.getElementById('collection-create-actions').hidden = !overview;
    document.getElementById('playlist-count-wrap').hidden = overview;
    document.getElementById('playlist-heading-name').textContent = overview || detail ? '歌单' : playlistTab === 'songs' ? '全部歌曲' : ({ queue: '待播', recent: '最近播放', excluded: '已排除' })[playlistTab];
    playlistFilterBtn.hidden = overview;
    playlistSearchEl.placeholder = overview ? '搜索歌单' : '搜索歌名或 BV 号';
    playlistSearchEl.setAttribute('aria-label', playlistSearchEl.placeholder);
    if (!detail) return;
    const list = getCollection(browsedPlaylistId), custom = getPersonalCollection(browsedPlaylistId);
    document.getElementById('collection-name').textContent = list ? list.name : '';
    document.getElementById('collection-add').hidden = !custom;
    const manage = document.getElementById('collection-manage');
    manage.textContent = custom ? '管理' : '复制为我的歌单';
    document.getElementById('collection-play').disabled = !getCollectionSongs(browsedPlaylistId).length;
}
function renderPersonalCollections(query) {
    playlistAlphaBarEl.replaceChildren();
    const grid = document.createElement('div'); grid.className = 'collection-grid';
    function group(label, lists) {
        const visible = lists.filter(list => !query || list.name.toLowerCase().includes(query));
        if (!visible.length) return;
        const heading = document.createElement('h4'); heading.className = 'collection-group-title'; heading.textContent = label; grid.append(heading);
        for (const list of visible) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'collection-card'; button.dataset.collectionId = list.id;
            const icon = document.createElement('span'); icon.className = 'collection-card-icon'; icon.textContent = list.id === 'smart-favorites' ? '♡' : list.id === 'smart-downloaded' ? '↓' : '♪'; icon.setAttribute('aria-hidden', 'true');
            if (list.profile) {
                const item = SG_WARDROBE.profile(list.profile);
                icon.style.setProperty('--collection-bg', 'rgba(' + item.rgb + ', .10)'); icon.style.setProperty('--collection-color', item.id === 'gladys' ? '#18838b' : item.color);
            }
            const copy = document.createElement('span'); copy.className = 'collection-card-copy';
            const name = document.createElement('strong'); name.textContent = list.name;
            const detail = document.createElement('small'); detail.textContent = list.songs.length + ' 首' + (playbackPlaylistId === list.id ? ' · 当前歌单' : '');
            copy.append(name, detail); button.append(icon, copy); grid.append(button);
        }
    }
    group('你的音乐', [getCollection('smart-favorites'), getCollection('smart-downloaded')]);
    group('我的歌单', getPersonalCollections());
    group('预置歌单', catalogPlaylists);
    if (!grid.childElementCount) {
        const empty = document.createElement('p'); empty.className = 'library-empty'; empty.textContent = '没有找到这个歌单。'; grid.append(empty);
    } else if (!query && !getPersonalCollections().length) {
        const hint = document.createElement('p'); hint.className = 'personal-description'; hint.style.gridColumn = '1 / -1'; hint.textContent = '点上方“新建歌单”，把喜欢的歌曲整理在一起。'; grid.append(hint);
    }
    playlistListEl.replaceChildren(grid);
}
function renderCollectionSongs(query) {
    const source = getCollectionSongs(browsedPlaylistId);
    const items = source.filter(song => (!query || song.name.toLowerCase().includes(query) || song.bvid.toLowerCase().includes(query)) && (!playlistFilterFavorites || isFavorite(song.bvid)));
    playlistCountEl.textContent = items.length === source.length ? String(source.length) : items.length + ' / ' + source.length;
    playlistAlphaBarEl.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const song of items) fragment.append(createPlaylistItemEl(song, 'collection:' + browsedPlaylistId + ':' + song.bvid, currentPlayingBvid));
    if (!items.length) {
        const empty = document.createElement('p'); empty.className = 'library-empty';
        empty.textContent = query || playlistFilterFavorites ? '没有找到符合条件的歌曲。' : browsedPlaylistId === 'smart-favorites' ? '收藏喜欢的歌曲后，会出现在这里。' : browsedPlaylistId === 'smart-downloaded' ? '缓存后的歌曲会出现在这里。' : '这个歌单还是空的，点“添加歌曲”开始整理吧。';
        fragment.append(empty);
    }
    playlistListEl.replaceChildren(fragment);
}
function startCollectionPlayback(id) {
    const list = getCollectionSongs(id);
    if (!list.length) { showToast('这个歌单还没有歌曲。'); return; }
    setPlaybackPlaylist(id); setPlayScope(id === 'smart-downloaded' ? 'downloaded' : 'all'); setPlayMode('list');
    playMusic(list[0].bvid); closePlaylist(); showView('play');
}
function configureCollectionSongActions(bvid) {
    const list = getPersonalCollection(actionPlaylistId), index = list ? list.songs.findIndex(song => song.bvid === bvid) : -1;
    for (const action of ['playlist-up', 'playlist-down', 'playlist-remove']) {
        const button = document.querySelector('[data-song-action="' + action + '"]');
        button.hidden = index < 0;
        button.disabled = action === 'playlist-up' && index === 0 || action === 'playlist-down' && list && index === list.songs.length - 1;
    }
}
function handleCollectionSongAction(action, song) {
    document.getElementById('song-actions-dialog').close();
    if (action === 'playlist') { openCollectionPicker(song); return; }
    try {
        if (action === 'playlist-remove') { personalLibrary.removeSong(actionPlaylistId, song.bvid); showToast('已移出这个歌单，歌曲和缓存仍保留。'); }
        if (action === 'playlist-up' || action === 'playlist-down') personalLibrary.move(actionPlaylistId, song.bvid, action === 'playlist-up' ? -1 : 1);
    } catch (error) { showToast(error.message, 5000); }
}
function openCollectionEditor(id, copySongs, defaultName) {
    editedPersonalPlaylist = id || '';
    const list = getPersonalCollection(id);
    const dialog = document.getElementById('collection-editor-dialog');
    dialog._copySongs = copySongs || [];
    document.getElementById('collection-editor-heading').textContent = list ? '管理歌单' : copySongs ? '复制歌单' : '新建歌单';
    document.getElementById('collection-editor-name').value = list ? list.name : defaultName || '';
    document.getElementById('collection-editor-status').textContent = '';
    document.getElementById('collection-delete-confirm').hidden = true;
    document.getElementById('collection-delete').hidden = !list;
    document.getElementById('collection-export').hidden = !list;
    dialog.showModal(); document.getElementById('collection-editor-name').focus();
}
function exportPersonalCollection(id) {
    const list = getPersonalCollection(id);
    if (!list) return;
    const blob = new Blob([personalLibrary.export(id)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = list.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 60) + '.json';
    document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
function openCollectionPicker(song) {
    pickerPersonalSong = song;
    const dialog = document.getElementById('collection-picker-dialog'), list = document.getElementById('collection-picker-list');
    document.getElementById('collection-picker-song').textContent = '《' + song.name + '》';
    document.getElementById('collection-picker-name').value = '';
    document.getElementById('collection-picker-status').textContent = '';
    list.replaceChildren();
    for (const collection of getPersonalCollections()) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.addToCollection = collection.id;
        const name = document.createElement('span'); name.textContent = collection.name;
        const count = document.createElement('small');
        const exists = collection.songs.some(item => item.bvid.toUpperCase() === song.bvid.toUpperCase());
        button.disabled = exists; count.textContent = exists ? '已加入' : collection.songs.length + ' 首';
        button.append(name, count); list.append(button);
    }
    if (!list.childElementCount) { const empty = document.createElement('p'); empty.className = 'personal-description'; empty.textContent = '还没有自建歌单，可以在下面新建一个。'; list.append(empty); }
    dialog.showModal();
}
function openCollectionAdd(id) {
    if (!getPersonalCollection(id)) return;
    addingPersonalPlaylist = id; selectedPersonalSongs.clear(); personalAddLimit = 60;
    document.getElementById('collection-add-search').value = '';
    document.getElementById('collection-add-status').textContent = '';
    renderCollectionAdd(); document.getElementById('collection-add-dialog').showModal();
}
function renderCollectionAdd() {
    const target = getPersonalCollection(addingPersonalPlaylist);
    if (!target) return;
    const query = document.getElementById('collection-add-search').value.trim().toLowerCase();
    const existing = new Set(target.songs.map(song => song.bvid.toUpperCase()));
    const source = songList.filter(song => !query || song.name.toLowerCase().includes(query) || song.bvid.toLowerCase().includes(query));
    const fragment = document.createDocumentFragment();
    for (const song of source.slice(0, personalAddLimit)) {
        const row = document.createElement('label'); row.className = 'collection-add-row';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = song.bvid; checkbox.disabled = existing.has(song.bvid.toUpperCase()); checkbox.checked = checkbox.disabled || selectedPersonalSongs.has(song.bvid);
        const name = document.createElement('span'); name.textContent = song.name;
        row.append(checkbox, name);
        if (checkbox.disabled) { const hint = document.createElement('small'); hint.textContent = '已加入'; row.append(hint); }
        fragment.append(row);
    }
    if (!source.length) { const empty = document.createElement('p'); empty.className = 'personal-description'; empty.textContent = '没有找到歌曲，可以用上方的 BV 号 / 链接添加，或从 B 站导入歌单。'; fragment.append(empty); }
    document.getElementById('collection-add-list').replaceChildren(fragment);
    document.getElementById('collection-add-more').hidden = source.length <= personalAddLimit;
    syncCollectionAddCount();
}
function syncCollectionAddCount() {
    document.getElementById('collection-add-count').textContent = '已选择 ' + selectedPersonalSongs.size + ' 首';
    document.getElementById('collection-add-save').disabled = !selectedPersonalSongs.size;
}
function populateImportTargets() {
    const select = document.getElementById('favorites-target'); select.replaceChildren();
    const option = document.createElement('option'); option.value = ''; option.textContent = '新建歌单（沿用收藏夹名称）'; select.append(option);
    for (const list of getPersonalCollections()) {
        const option = document.createElement('option'); option.value = list.id; option.textContent = list.name; select.append(option);
    }
    select.value = playlistTab === 'songs' && viewPlaylist.classList.contains('is-open') && getPersonalCollection(browsedPlaylistId) ? browsedPlaylistId : '';
}
function getImportTargetSongs() { const list = getPersonalCollection(document.getElementById('favorites-target').value); return list ? list.songs : []; }
function importFavoritePlaylist(songs, source) {
    const id = document.getElementById('favorites-target').value;
    let count;
    if (id) { count = personalLibrary.add(id, songs); lastImportedPlaylist = id; }
    else { lastImportedPlaylist = personalLibrary.create(source && source.title || 'B 站导入', songs); count = songs.length; }
    return count;
}

(function initializePersonalLibrary() {
    for (const dialog of document.querySelectorAll('.personal-dialog')) {
        dialog.querySelectorAll('[data-close-personal]').forEach(button => button.addEventListener('click', () => dialog.close()));
    }
    playlistListEl.addEventListener('click', event => { const card = event.target.closest('[data-collection-id]'); if (card) openCollection(card.dataset.collectionId); });
    document.getElementById('collection-create').addEventListener('click', () => openCollectionEditor());
    document.getElementById('collection-back').addEventListener('click', () => { browsedPlaylistId = ''; openPlaylist(undefined, 'collections'); });
    document.getElementById('collection-play').addEventListener('click', () => startCollectionPlayback(browsedPlaylistId));
    document.getElementById('collection-add-bvid').addEventListener('click', () => {
        document.getElementById('collection-add-dialog').close(); openCustomForm(null, addingPersonalPlaylist);
    });
    document.getElementById('collection-add').addEventListener('click', () => openCollectionAdd(browsedPlaylistId));
    document.getElementById('collection-manage').addEventListener('click', () => {
        const list = getCollection(browsedPlaylistId);
        if (getPersonalCollection(browsedPlaylistId)) openCollectionEditor(browsedPlaylistId);
        else if (list) openCollectionEditor('', getCollectionSongs(browsedPlaylistId), list.name + ' · 我的版本');
    });
    document.getElementById('settings-open-collections').addEventListener('click', () => { document.getElementById('settings-modal-backdrop').classList.remove('is-open'); openPlaylist(undefined, 'collections'); });
    document.getElementById('collection-import-bili').addEventListener('click', () => favoritesImporter.open());
    document.getElementById('collection-import-file').addEventListener('click', () => { const input = document.getElementById('collection-file-input'); input.value = ''; input.click(); });
    document.getElementById('collection-file-input').addEventListener('change', async event => {
        const file = event.target.files[0]; if (!file) return;
        try {
            if (file.size > SG_PERSONAL.MAX_BYTES) throw new Error('导入文件不能超过 2 MB。');
            const id = personalLibrary.import(await file.text(), file.name.replace(/\.(json|txt)$/i, ''));
            openCollection(id); showToast('歌单已导入，重复歌曲会自动合并。');
        } catch (error) { showToast(error.message || '歌单导入失败。', 5000); }
    });
    document.getElementById('collection-editor-form').addEventListener('submit', event => {
        event.preventDefault();
        try {
            const name = document.getElementById('collection-editor-name').value, dialog = document.getElementById('collection-editor-dialog');
            let id = editedPersonalPlaylist;
            if (id) personalLibrary.rename(id, name); else id = personalLibrary.create(name, dialog._copySongs);
            dialog.close(); openCollection(id); showToast(editedPersonalPlaylist ? '歌单名称已保存。' : '歌单已创建，可以开始添加歌曲了。');
        } catch (error) { document.getElementById('collection-editor-status').textContent = error.message; }
    });
    document.getElementById('collection-export').addEventListener('click', () => { try { exportPersonalCollection(editedPersonalPlaylist); } catch (error) { showToast(error.message); } });
    document.getElementById('collection-delete').addEventListener('click', () => { document.getElementById('collection-delete-confirm').hidden = false; });
    document.getElementById('collection-delete-cancel').addEventListener('click', () => { document.getElementById('collection-delete-confirm').hidden = true; });
    document.getElementById('collection-delete-confirm-button').addEventListener('click', () => {
        try { personalLibrary.remove(editedPersonalPlaylist); document.getElementById('collection-editor-dialog').close(); openPlaylist(undefined, 'collections'); showToast('歌单已删除，歌曲和缓存仍保留。'); }
        catch (error) { document.getElementById('collection-editor-status').textContent = error.message; }
    });
    document.getElementById('collection-picker-list').addEventListener('click', event => {
        const button = event.target.closest('[data-add-to-collection]'); if (!button || !pickerPersonalSong) return;
        try { personalLibrary.add(button.dataset.addToCollection, [pickerPersonalSong]); document.getElementById('collection-picker-dialog').close(); showToast('已加入歌单。'); }
        catch (error) { document.getElementById('collection-picker-status').textContent = error.message; }
    });
    document.getElementById('collection-picker-create').addEventListener('submit', event => {
        event.preventDefault(); if (!pickerPersonalSong) return;
        try { personalLibrary.create(document.getElementById('collection-picker-name').value, [pickerPersonalSong]); document.getElementById('collection-picker-dialog').close(); showToast('歌单已创建，歌曲已加入。'); }
        catch (error) { document.getElementById('collection-picker-status').textContent = error.message; }
    });
    document.getElementById('collection-add-search').addEventListener('input', window.SG_PLAYBACK_UI.frameTask(() => { personalAddLimit = 60; renderCollectionAdd(); }));
    document.getElementById('collection-add-more').addEventListener('click', () => { personalAddLimit += 60; renderCollectionAdd(); });
    document.getElementById('collection-add-list').addEventListener('change', event => {
        if (!event.target.matches('input[type="checkbox"]') || event.target.disabled) return;
        if (event.target.checked) selectedPersonalSongs.add(event.target.value); else selectedPersonalSongs.delete(event.target.value);
        syncCollectionAddCount();
    });
    document.getElementById('collection-add-save').addEventListener('click', () => {
        try {
            const count = personalLibrary.add(addingPersonalPlaylist, songList.filter(song => selectedPersonalSongs.has(song.bvid)));
            document.getElementById('collection-add-dialog').close(); showToast('已加入 ' + count + ' 首歌曲。');
        } catch (error) { document.getElementById('collection-add-status').textContent = error.message; }
    });
    window.addEventListener('sg:appearance', event => {
        const item = event.detail;
        const switched = CONFIG.vmid !== item.vmid;
        CONFIG.titleSuffix = item.short; CONFIG.defaultTitle = item.name; CONFIG.vmid = item.vmid;
        DEFAULT_TITLE = item.name; updateDocumentTitle(); updateMediaSession();
        if (switched) { fanCountElement.textContent = '…'; fetchFanCount(); }
        if (window.__SG_ANDROID_PING) window.__SG_ANDROID_PING();
    });
    window.addEventListener('sg:artwork', () => updateMediaSession());
    validatePlaybackPlaylist(); syncCollectionToolbar(); playlistRenderKey = ''; renderPlaylist();
})();
