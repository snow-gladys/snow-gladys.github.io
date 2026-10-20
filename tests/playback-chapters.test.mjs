import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const A = 'BV17uZQBHEDo', B = 'BV1Sf421Q7Rt';
const chapters = [{ name: '前奏', start: 0, end: 10 }, { name: '副歌', start: 10, end: 30 }, { name: '尾声', start: 40, end: 60 }];
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function storage() {
    const values = new Map();
    return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), values };
}
function element() {
    const listeners = {}, attributes = {}, classes = new Set();
    return { value: '', textContent: '', dataset: {}, children: [], hidden: false, disabled: false, open: false,
        classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        emit(type, event = {}) { for (const fn of listeners[type] || []) fn(event); },
        setAttribute(name, value) { attributes[name] = value; }, removeAttribute(name) { delete attributes[name]; }, getAttribute: name => attributes[name],
        replaceChildren(...nodes) { this.children = nodes; }, append(...nodes) { this.children.push(...nodes); },
        showModal() { this.open = true; }, close() { this.open = false; }, querySelector() { return this.closeButton; },
    };
}
function api() {
    const context = vm.createContext({ window: {}, URL, document: { createElement: element }, AbortController, DOMException, setTimeout, clearTimeout });
    vm.runInContext(read('bili-api.js'), context); vm.runInContext(read('playback-chapters.js'), context);
    return context.window.SG_PLAYBACK_CHAPTERS;
}

test('chapters survive reload and are shared between import, playback and fragments of the same P', async () => {
    const module = api(), local = storage(), requested = [];
    const store = module.createStore({ storage: local, client: { async chapters(id) { requested.push(id); return { chapters }; } } });
    await store.chapters(A + '@p2@t10-30'); await store.chapters(A + '@p2');
    assert.deepEqual(requested, [A + '@p2']); assert.equal(store.peek(A), null);
    const restored = module.createStore({ storage: local, client: { chapters() { assert.fail('fresh saved chapters must work offline'); } } });
    assert.deepEqual(plain((await restored.chapters(A + '@p2')).chapters), chapters);
    assert.equal(restored.peek(A + '@p2@t20-25').chapters.length, 3);
});

test('stale chapters stay usable offline and explicit refresh replaces the persisted directory', async () => {
    const module = api(), local = storage();
    local.setItem('sg_video_chapters_v1', JSON.stringify([{ key: A, chapters, savedAt: 1 }]));
    let offline = true;
    const store = module.createStore({ storage: local, client: { async chapters() { if (offline) throw new Error('offline'); return { chapters: [{ name: '新章节', start: 1, end: 8 }] }; } } });
    const cached = await store.chapters(A); assert.equal(cached.chapters.length, 3); assert.match(cached.warning, /已保存/);
    offline = false; const updated = await store.chapters(A, { force: true }); assert.equal(updated.chapters[0].name, '新章节');
    assert.equal(JSON.parse(local.getItem('sg_video_chapters_v1'))[0].chapters[0].name, '新章节');
});

test('overlapping requests share work and cancelled import results cannot replace saved chapters', async () => {
    const module = api(); let finish, calls = 0;
    const store = module.createStore({ client: { chapters: () => { calls++; return new Promise(resolve => { finish = resolve; }); } } });
    const first = store.chapters(A), second = store.chapters(A); assert.equal(calls, 1);
    finish({ chapters }); await Promise.all([first, second]);
    const controller = new AbortController(), aborted = store.chapters(B, { signal: controller.signal });
    controller.abort(); finish({ chapters }); await assert.rejects(aborted, { name: 'AbortError' }); assert.equal(store.peek(B), null);
});

test('invalid rows are discarded and storage remains within its bounds', async () => {
    const module = api(), local = storage();
    assert.deepEqual(plain(module.clean([{ name: 'bad', start: 10, end: 0 }, { name: 'negative', start: -1, end: 2 }, ...chapters, ...chapters])), chapters);
    const store = module.createStore({ storage: local, client: { chapters: async () => ({ chapters }) } });
    for (let page = 1; page <= 70; page++) await store.chapters(A + '@p' + page);
    assert.equal(JSON.parse(local.getItem('sg_video_chapters_v1')).length, 64); assert.equal(store.peek(A), null);
    assert.ok(local.getItem('sg_video_chapters_v1').length <= 256 * 1024);
    const unavailable = module.createStore({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } }, client: { chapters: async () => ({ chapters }) } });
    assert.equal((await unavailable.chapters(A)).chapters.length, 3);
});

test('chapter navigation maps fragments to relative time and does not highlight gaps', () => {
    const module = api(), visible = module.visibleChapters(chapters, { start: 15, end: 50 });
    assert.deepEqual(plain(visible), [{ name: '副歌', start: 10, end: 30, time: 0, until: 15 }, { name: '尾声', start: 40, end: 60, time: 25, until: 35 }]);
    assert.equal(module.activeIndex(visible, 0), 0); assert.equal(module.activeIndex(visible, 20), -1); assert.equal(module.activeIndex(visible, 26), 1);
});

function navigator(store, id = A) {
    const module = api(), button = element(), label = element(), dialog = element(), list = element(), status = element(), retry = element(), heading = element();
    dialog.closeButton = element(); let current = id, position = 0, ready = true, paused = true, seeks = [];
    const ui = module.createNavigator({ store, button, label, dialog, list, status, retry, heading,
        track: () => current, time: () => position, name: () => current, canSeek: () => ready,
        format: seconds => String(seconds), seek: time => { position = time; seeks.push(time); }, onSeek() {} });
    return { ui, button, label, dialog, list, status, retry, heading, seeks, paused: () => paused,
        track: value => { current = value; }, time: value => { position = value; }, ready: value => { ready = value; } };
}

test('playback directory highlights current chapter and clicking seeks without resuming paused music', async () => {
    const h = navigator({ peek: () => ({ chapters, savedAt: Date.now() }), chapters() { assert.fail('saved directory must not refetch'); } });
    h.button.emit('click'); assert.equal(h.dialog.open, true); assert.equal(h.list.children[0].getAttribute('aria-current'), 'true');
    h.list.emit('click', { target: { closest: () => h.list.children[1] } });
    assert.deepEqual(h.seeks, [10]); assert.equal(h.paused(), true); assert.equal(h.dialog.open, false); assert.match(h.label.textContent, /副歌/);
    h.time(35); h.ui.sync(); assert.ok(h.list.children.every(row => !row.classList.contains('is-current')));
    h.ready(false); h.ui.sync(); assert.ok(h.list.children.every(row => row.disabled));
    h.list.emit('click', { target: { closest: () => h.list.children[2] } }); assert.deepEqual(h.seeks, [10]);
});

test('switching tracks discards late chapter responses and former directory buttons', async () => {
    const requests = new Map(), h = navigator({ peek: () => null, chapters: id => new Promise(resolve => requests.set(id, resolve)) });
    const first = h.ui.ensure(); h.track(B); const second = h.ui.ensure();
    requests.get(B)({ chapters: [{ name: '新歌章节', start: 2, end: 20 }] }); await second;
    requests.get(A)({ chapters }); await first;
    assert.equal(h.list.children.length, 1); assert.match(h.list.children[0].children[1].textContent, /新歌章节/);
    h.track(''); h.ui.refresh(); assert.equal(h.button.hidden, true); assert.equal(h.dialog.open, false);
});

test('chapter loading errors expose retry without affecting music playback', async () => {
    let fails = true;
    const h = navigator({ peek: () => null, async chapters() { if (fails) throw new Error('offline'); return { chapters }; } });
    await h.ui.ensure(); assert.match(h.status.textContent, /歌曲会继续播放/); assert.equal(h.retry.disabled, false);
    fails = false; h.retry.emit('click'); await tick(); assert.equal(h.list.children.length, 3); assert.equal(h.seeks.length, 0); assert.equal(h.paused(), true);
});
