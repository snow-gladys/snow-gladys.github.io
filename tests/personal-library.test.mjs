import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const A = { bvid: 'BV1Sf421Q7Rt', name: '探窗' }, B = { bvid: 'BV1Cn4y1o7yG', name: '如果可以' }, C = { bvid: 'BV1SM4m1U7SL', name: '天空没有极限' };
function storage(initial = {}) {
    const values = new Map(Object.entries(initial).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
    return { values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value) };
}
function api() { const context = vm.createContext({ TextEncoder }); vm.runInContext(read('personal-library.js'), context); return context.SG_PERSONAL; }
function library(store = storage()) { return api().create({ storage: store }); }

test('playlist changes persist in order and survive a new session', () => {
    const store = storage(), lib = library(store), id = lib.create('  通勤  ', [A, B]);
    assert.equal(lib.get(id).name, '通勤');
    assert.equal(lib.add(id, [A, C, { bvid: 'bad' }]), 1);
    lib.move(id, C.bvid, -1); lib.rename(id, '晚间通勤');
    assert.deepEqual(plain(library(store).get(id).songs), [A, C, B]);
    assert.equal(library(store).get(id).name, '晚间通勤');
    lib.removeSong(id, C.bvid);
    assert.deepEqual(plain(lib.get(id).songs), [A, B]);
});

test('removing a playlist or one entry retains imported tracks and other playlists', () => {
    const lib = library(), first = lib.create('第一张', [A, B]), second = lib.create('第二张', [A]);
    lib.removeSong(first, B.bvid); lib.remove(first);
    assert.deepEqual(plain(lib.get(second).songs), [A]);
    assert.deepEqual(plain(lib.allSongs()), [A, B]);
});

test('duplicate names create distinct lists; duplicate BV references inside one list are merged', () => {
    const lib = library(), a = lib.create('我的歌单', [A, A]), b = lib.create('我的歌单', [A]);
    assert.notEqual(a, b); assert.equal(lib.get(a).songs.length, 1);
    assert.equal(lib.add(a, [{ ...A, bvid: 'bv' + A.bvid.slice(2) }]), 0);
    assert.throws(() => lib.create('  '), /名字/);
});

test('quota failure does not change memory, revision or last saved data', () => {
    const store = storage(), lib = library(store), id = lib.create('原歌单', [A]), saved = store.getItem(api().KEY), revision = lib.revision;
    store.setItem = () => { throw new Error('QuotaExceededError'); };
    assert.throws(() => lib.add(id, [B]), /保存失败/);
    assert.throws(() => lib.rename(id, '新名称'), /保存失败/);
    assert.deepEqual(plain(lib.get(id).songs), [A]);
    assert.equal(lib.get(id).name, '原歌单'); assert.equal(lib.revision, revision); assert.equal(store.getItem(api().KEY), saved);
});

test('corrupt and future-format stored playlists are retained and never silently overwritten', () => {
    for (const raw of ['{broken', JSON.stringify({ version: 20, lists: [] }), JSON.stringify({ version: 1, lists: [{ id: '../bad', name: 'x' }] })]) {
        const store = storage({ sg_playlists_v1: raw }), lib = library(store);
        assert.ok(lib.error); assert.throws(() => lib.create('test'));
        assert.equal(store.getItem('sg_playlists_v1'), raw);
    }
});

test('JSON and legacy TXT imports round-trip without overwriting existing lists', () => {
    const lib = library(), id = lib.create('通勤 <b> & "音乐"', [A, B]);
    const imported = lib.import(lib.export(id));
    assert.notEqual(imported, id); assert.deepEqual(plain(lib.get(imported).songs), [A, B]);
    const old = lib.import(JSON.stringify([A, A, { name: '坏编号', bvid: 'AV123' }]), '旧版文件');
    assert.equal(lib.get(old).name, '旧版文件'); assert.deepEqual(plain(lib.get(old).songs), [A]);
    assert.throws(() => lib.import('bad'), /文件格式/);
    assert.throws(() => lib.import('{"songs":[{"bvid":"bad"}]}'), /有效/);
    assert.throws(() => lib.import('a'.repeat(2 * 1024 * 1024 + 1)), /2 MB/);
});

test('playlist and entry limits reject changes before storage', () => {
    const lib = library();
    for (let i = 0; i < 50; i++) lib.create('歌单' + i);
    assert.throws(() => lib.create('第51张'), /50/);
    const many = Array.from({ length: 2001 }, (_, i) => ({ bvid: 'BV' + String(i).padStart(10, '0'), name: '歌' + i }));
    assert.throws(() => library().create('太长了', many), /2000/);
});

test('legacy Fiona and Gladys data merge once, preserving original keys and recent timestamps', () => {
    const store = storage({ sg_fav: [A.bvid], sg_fav_fiona: [B.bvid], sg_custom_songs: [A], sg_custom_songs_fiona: [B],
        sg_play_mode_library: { recent: [{ ...A, playedAt: 30 }], queue: [A], excluded: [A], anchor: A.bvid, active: true },
        sg_play_mode_fiona_library: { recent: [{ ...A, playedAt: 10 }, { ...B, playedAt: 40 }], queue: [B], excluded: [B] },
        sg_play_mode_fiona: 'random', sg_play_mode_fiona_scope: 'favorites' });
    const source = store.getItem('sg_custom_songs_fiona'), oldHistory = store.getItem('sg_play_mode_fiona_library');
    api().migrateLegacy(store);
    assert.deepEqual(JSON.parse(store.getItem('sg_custom_songs')), [A, B]);
    assert.deepEqual(JSON.parse(store.getItem('sg_fav')), [A.bvid.toUpperCase(), B.bvid.toUpperCase()]);
    const history = JSON.parse(store.getItem('sg_play_mode_library'));
    assert.deepEqual(history.recent.map(song => [song.bvid, song.playedAt]), [[B.bvid, 40], [A.bvid, 30]]);
    assert.deepEqual(history.queue.map(song => song.bvid), [A.bvid, B.bvid]); assert.equal(history.anchor, A.bvid);
    assert.equal(store.getItem('sg_play_mode'), 'random'); assert.equal(store.getItem('sg_play_mode_scope'), 'favorites');
    assert.equal(store.getItem('sg_custom_songs_fiona'), source); assert.equal(store.getItem('sg_play_mode_fiona_library'), oldHistory);
    assert.equal(library(store).list().length, 4);
    store.setItem('sg_fav', '[]'); api().migrateLegacy(store);
    assert.equal(store.getItem('sg_fav'), '[]'); assert.equal(library(store).list().length, 4);
});

test('interrupted legacy migration is idempotent on retry and never marks failed migration complete', () => {
    const store = storage({ sg_custom_songs: [A], sg_custom_songs_fiona: [B] }), write = store.setItem;
    store.setItem = (key, value) => { if (key === 'sg_custom_songs') throw new Error('full'); write(key, value); };
    assert.throws(() => api().migrateLegacy(store));
    assert.equal(store.getItem('sg_unified_library_v1'), null);
    store.setItem = write; api().migrateLegacy(store);
    assert.equal(library(store).list().length, 2);
    assert.deepEqual(JSON.parse(store.getItem('sg_custom_songs')), [A, B]);
});

test('Fiona-only queue migration preserves where playback should return after queued songs', () => {
    const store = storage({ sg_play_mode_fiona_library: { queue: [B], recent: [A], excluded: [], anchor: A.bvid, active: true } });
    api().migrateLegacy(store);
    const history = JSON.parse(store.getItem('sg_play_mode_library'));
    assert.equal(history.anchor, A.bvid); assert.equal(history.active, true);
    assert.equal(history.queue[0].bvid, B.bvid);
});

test('five appearance presets keep exact member colors and bounded square crop geometry', () => {
    const context = vm.createContext({}); vm.runInContext(read('wardrobe.js'), context);
    const wardrobe = context.SG_WARDROBE;
    assert.deepEqual(plain(wardrobe.profiles.map(item => item.name)), ['思诺 Gladys', '心宜 Fiona', '嘉然 Diana', '乃琳 Eileen', '贝拉 Bella']);
    assert.deepEqual(plain(wardrobe.profiles.slice(2).map(item => item.color)), ['#E799B0', '#576690', '#DB7D74']);
    assert.equal(wardrobe.MAX_BYTES * 5, 2.5 * 1024 * 1024);
    for (const [width, height] of [[4000, 1000], [1000, 4000], [100, 100]]) for (const zoom of [1, 2, 3, 0, 100]) for (const position of [-1, 0, 0.5, 1, 2]) {
        const crop = wardrobe.cropRect(width, height, zoom, position, position);
        assert.ok(crop.side > 0 && crop.side <= Math.min(width, height));
        assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.side <= width && crop.y + crop.side <= height);
    }
});

test('the removed Fiona page redirects through the site fallback, without maintaining another player', () => {
    assert.equal(existsSync(new URL('../fiona/index.html', import.meta.url)), false);
    const redirected = [];
    const html = read('404.html'), script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    for (const path of ['/fiona', '/fiona/', '/fiona/index.html', '/elsewhere']) vm.runInNewContext(script, { location: { pathname: path, replace: url => redirected.push(url) } });
    assert.deepEqual(redirected, ['/?from=fiona', '/?from=fiona', '/?from=fiona']);
});

test('playlist playback scope stays inside that playlist for list, favorites and downloaded modes', () => {
    const source = read('index.js'), start = source.indexOf('function getEffectiveList()');
    const sandbox = vm.createContext({ playbackPlaylistId: 'my-playlist', playScope: 'all',
        getCollectionSongs: () => [A, B], songList: [A, B, C], isFavorite: id => id === B.bvid,
        cachedBvidsSet: new Set([A.bvid]), getFavoritesList: () => [B, C], getDownloadedList: () => [A, C],
    });
    vm.runInContext(source.slice(start, source.indexOf('/** 在当前模式列表', start)), sandbox);
    assert.deepEqual(plain(sandbox.getEffectiveList()), [A, B]);
    sandbox.playScope = 'favorites'; assert.deepEqual(plain(sandbox.getEffectiveList()), [B]);
    sandbox.playScope = 'downloaded'; assert.deepEqual(plain(sandbox.getEffectiveList()), [A]);
    sandbox.getCollectionSongs = () => []; assert.deepEqual(plain(sandbox.getEffectiveList()), []);
    sandbox.playbackPlaylistId = ''; assert.deepEqual(plain(sandbox.getEffectiveList()), [A, C]);
});
