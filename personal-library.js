/* 用户歌单与旧版数据合并。修改先落盘，成功后才更新内存；保留全部旧版存储键。 */
(function (root) {
    'use strict';
    const KEY = 'sg_playlists_v1', MIGRATION = 'sg_unified_library_v1';
    const MAX_LISTS = 50, MAX_SONGS = 2000, MAX_BYTES = 2 * 1024 * 1024;
    function songs(values) {
        const seen = new Set();
        return (Array.isArray(values) ? values : []).flatMap(value => {
            if (!value || typeof value.bvid !== 'string') return [];
            const bvid = value.bvid.trim().replace(/^bv/i, 'BV');
            if (!/^BV[0-9a-zA-Z]{10}$/.test(bvid) || seen.has(bvid.toUpperCase())) return [];
            seen.add(bvid.toUpperCase());
            return [{ bvid, name: String(value.name || value.title || bvid).trim().slice(0, 300) || bvid }];
        });
    }
    function title(value) { return String(value || '').trim().slice(0, 40); }
    function read(storage, key, fallback) {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    }
    function encode(data) {
        const text = JSON.stringify(data);
        if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('歌单占用已达 2 MB，请先整理部分歌单。');
        return text;
    }
    function create(options) {
        let data = { version: 1, lists: [], catalog: [] }, error = '', revision = 0, serial = 0;
        try {
            const stored = read(options.storage, KEY, data);
            if (!stored || stored.version !== 1 || !Array.isArray(stored.lists)) throw new Error('歌单数据无法读取，原数据已保留。');
            data.catalog = songs(stored.catalog);
            const ids = new Set();
            data.lists = stored.lists.map(list => {
                if (!list || typeof list.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(list.id) || ids.has(list.id) || !title(list.name)) throw new Error('歌单数据无法读取，原数据已保留。');
                ids.add(list.id);
                return { id: list.id, name: title(list.name), songs: songs(list.songs) };
            });
        } catch (reason) { error = reason.message || '无法读取歌单。'; }
        function commit(change) {
            if (error) throw new Error(error);
            const next = JSON.parse(JSON.stringify(data));
            const result = change(next);
            next.catalog = songs([...next.catalog, ...next.lists.flatMap(list => list.songs)]);
            if (next.lists.length > MAX_LISTS) throw new Error('最多保留 50 个自建歌单，请先整理部分歌单。');
            if (next.lists.some(list => list.songs.length > MAX_SONGS)) throw new Error('每个歌单最多保留 2000 首歌曲。');
            try { options.storage.setItem(KEY, encode(next)); }
            catch (reason) { throw new Error(reason.message && reason.message.includes('2 MB') ? reason.message : '歌单保存失败，请检查设备存储空间后重试。'); }
            data = next; revision++;
            if (options.onChange) options.onChange();
            return result;
        }
        function find(next, id) {
            const list = next.lists.find(value => value.id === id);
            if (!list) throw new Error('这个歌单已经不存在了。');
            return list;
        }
        return {
            get error() { return error; }, get revision() { return revision; },
            list() { return JSON.parse(JSON.stringify(data.lists)); },
            get(id) { const list = data.lists.find(value => value.id === id); return list ? JSON.parse(JSON.stringify(list)) : null; },
            allSongs() { return songs([...data.catalog, ...data.lists.flatMap(list => list.songs)]); },
            create(name, values) {
                const clean = title(name);
                if (!clean) throw new Error('请先给歌单起个名字。');
                const id = 'pl-' + Date.now().toString(36) + '-' + (++serial) + '-' + Math.random().toString(36).slice(2, 9);
                return commit(next => { next.lists.push({ id, name: clean, songs: songs(values) }); return id; });
            },
            rename(id, name) {
                const clean = title(name);
                if (!clean) throw new Error('请先给歌单起个名字。');
                commit(next => { find(next, id).name = clean; });
            },
            remove(id) { commit(next => { find(next, id); next.lists = next.lists.filter(list => list.id !== id); }); },
            add(id, values) {
                return commit(next => { const list = find(next, id), old = list.songs.length; list.songs = songs([...list.songs, ...songs(values)]); return list.songs.length - old; });
            },
            removeSong(id, bvid) { commit(next => { const list = find(next, id); list.songs = list.songs.filter(song => song.bvid !== bvid); }); },
            move(id, bvid, step) {
                commit(next => {
                    const list = find(next, id), index = list.songs.findIndex(song => song.bvid === bvid), target = index + step;
                    if (index < 0 || target < 0 || target >= list.songs.length) return;
                    [list.songs[index], list.songs[target]] = [list.songs[target], list.songs[index]];
                });
            },
            import(text, fallbackName) {
                if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('导入文件不能超过 2 MB。');
                let parsed;
                try { parsed = JSON.parse(text); } catch (_) { throw new Error('文件格式不正确，请选择导出的 JSON 或旧版 TXT 歌单。'); }
                const values = Array.isArray(parsed) ? parsed : parsed && parsed.songs;
                if (!Array.isArray(values)) throw new Error('文件中没有可读取的歌曲列表。');
                const clean = songs(values);
                if (values.length && !clean.length) throw new Error('文件中没有有效的 BV 号歌曲。');
                return this.create(title(parsed.name) || title(fallbackName) || '导入的歌单', clean);
            },
            export(id) { const list = this.get(id); if (!list) throw new Error('歌单不存在。'); return JSON.stringify({ version: 1, name: list.name, songs: list.songs }, null, 2); },
        };
    }

    function migrateLegacy(storage) {
        if (!storage || storage.getItem(MIGRATION) === '1') return;
        function array(key) {
            const data = read(storage, key, []);
            if (!Array.isArray(data)) throw new Error('旧版数据格式异常，原数据已保留。');
            return data;
        }
        const rootCustom = songs(array('sg_custom_songs')), fionaCustom = songs(array('sg_custom_songs_fiona'));
        const rootFav = array('sg_fav').filter(value => typeof value === 'string'), fionaFav = array('sg_fav_fiona').filter(value => typeof value === 'string');
        const existing = read(storage, KEY, { version: 1, lists: [] });
        if (existing.version !== 1 || !Array.isArray(existing.lists)) throw new Error('歌单数据无法读取，原数据已保留。');
        const catalog = songs([...rootCustom, ...fionaCustom]);
        const resolve = ids => songs(ids.map(bvid => catalog.find(song => song.bvid.toUpperCase() === bvid.toUpperCase()) || { bvid, name: bvid }));
        const legacy = [
            { id: 'legacy-gladys-custom', name: '我导入的歌曲', songs: rootCustom },
            { id: 'legacy-fiona-custom', name: '心宜 · 自定义歌曲', songs: fionaCustom },
            { id: 'legacy-fiona-favorites', name: '心宜 · 收藏', songs: resolve(fionaFav) },
            ...(fionaFav.length ? [{ id: 'legacy-gladys-favorites', name: '思诺 · 收藏', songs: resolve(rootFav) }] : []),
        ];
        for (const list of legacy) if (list.songs.length && !existing.lists.some(item => item.id === list.id)) existing.lists.push(list);
        // 每一步均为合并操作，最后写标记；中途存储失败后可安全重试。
        storage.setItem(KEY, encode(existing));
        if (fionaCustom.length) storage.setItem('sg_custom_songs', JSON.stringify(catalog));
        if (fionaFav.length) storage.setItem('sg_fav', JSON.stringify([...new Set([...rootFav, ...fionaFav].map(id => id.toUpperCase()))]));
        const oldHistory = read(storage, 'sg_play_mode_fiona_library', null);
        if (oldHistory) {
            const history = read(storage, 'sg_play_mode_library', { queue: [], recent: [], excluded: [], anchor: oldHistory.anchor || null, active: oldHistory.active === true });
            for (const key of ['queue', 'recent', 'excluded']) {
                const combined = [...(Array.isArray(history[key]) ? history[key] : []), ...(Array.isArray(oldHistory[key]) ? oldHistory[key] : [])];
                if (key === 'recent') combined.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
                const clean = songs(combined), times = new Map();
                for (const item of combined) times.set(item.bvid, Math.max(times.get(item.bvid) || 0, item.playedAt || 0));
                history[key] = clean.slice(0, key === 'recent' ? 100 : key === 'queue' ? 200 : 10000).map(item => key === 'recent' ? { ...item, playedAt: times.get(item.bvid) || 0 } : item);
            }
            storage.setItem('sg_play_mode_library', JSON.stringify(history));
        }
        for (const suffix of ['', '_scope', '_session']) {
            const key = 'sg_play_mode' + suffix;
            if (storage.getItem(key) === null && storage.getItem('sg_play_mode_fiona' + suffix) !== null) storage.setItem(key, storage.getItem('sg_play_mode_fiona' + suffix));
        }
        storage.setItem(MIGRATION, '1');
    }
    root.SG_PERSONAL = { create, songs, migrateLegacy, KEY, MAX_LISTS, MAX_SONGS, MAX_BYTES };
})(typeof window === 'undefined' ? globalThis : window);
