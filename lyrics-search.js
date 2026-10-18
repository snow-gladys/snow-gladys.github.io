/* 按需搜索 LRCLIB；候选预览不会直接写入本地歌词。 */
(function (global) {
    'use strict';
    function guessTitle(name) {
        var text = String(name || '').trim();
        var match = /《([^》]+)》/.exec(text);
        return (match ? match[1] : text).slice(0, 200);
    }
    function prepareRecord(record) {
        if (!record || record.instrumental || !Number.isSafeInteger(record.id) || record.id <= 0) return null;
        var synced = typeof record.syncedLyrics === 'string' ? record.syncedLyrics.trim() : '';
        var timed = synced && global.SG_LYRICS.parseLrc(synced).some(function (line) { return !!line.text; });
        var plain = typeof record.plainLyrics === 'string' ? record.plainLyrics.trim() : '';
        if (!timed && !plain) return null;
        return {
            id: record.id, name: String(record.trackName || record.name || '未知歌名'),
            artist: String(record.artistName || '未知歌手'), album: String(record.albumName || ''),
            duration: Number.isFinite(record.duration) && record.duration > 0 ? record.duration : 0,
            timed: !!timed,
            // 纯文本没有可借用的时间轴；从同一起点开始，供用户逐句调轴。
            lrc: timed ? synced : plain.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean)
                .map(function (line) { return '[00:00.00] ' + line; }).join('\n'),
            preview: timed ? synced : plain,
        };
    }
    async function search(title, artist, signal) {
        title = String(title || '').trim();
        artist = String(artist || '').trim();
        if (!title) throw new Error('请输入歌名后搜索。');
        var controller = new AbortController(), timedOut = false;
        function abort() { controller.abort(); }
        if (signal && signal.aborted) throw new DOMException('已取消搜索', 'AbortError');
        if (signal) signal.addEventListener('abort', abort, { once: true });
        var timer = setTimeout(function () { timedOut = true; controller.abort(); }, 15000);
        try {
            var params = new URLSearchParams({ track_name: title });
            if (artist) params.set('artist_name', artist);
            var response = await fetch('https://lrclib.net/api/search?' + params, { signal: controller.signal });
            if (!response.ok) throw new Error(response.status === 429 ? '搜索过于频繁，请稍后再试。' : '歌词库暂时不可用，请稍后重新搜索。');
            var data;
            try { data = await response.json(); }
            catch (error) {
                if (error.name === 'AbortError') throw error;
                throw new Error('歌词库返回的数据异常，请重新搜索。');
            }
            if (!Array.isArray(data)) throw new Error('歌词库返回的数据异常，请重新搜索。');
            var seen = new Set();
            return data.slice(0, 20).map(prepareRecord).filter(function (item) {
                if (!item || seen.has(item.id)) return false;
                seen.add(item.id); return true;
            }).sort(function (a, b) { return Number(b.timed) - Number(a.timed); });
        } catch (error) {
            if (timedOut) throw new Error('搜索超时，请检查网络后重新搜索。');
            if (error.name === 'AbortError') throw error;
            if (error instanceof TypeError) throw new Error('无法连接歌词库，请检查网络后重新搜索。');
            throw error;
        } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', abort);
        }
    }
    function create(options) {
        var toggle = document.getElementById('lyric-search-toggle');
        var panel = document.getElementById('lyric-search-panel');
        var form = document.getElementById('lyric-search-form');
        var title = document.getElementById('lyric-search-title');
        var artist = document.getElementById('lyric-search-artist');
        var status = document.getElementById('lyric-search-status');
        var results = document.getElementById('lyric-search-results');
        var preview = document.getElementById('lyric-search-preview');
        var previewName = document.getElementById('lyric-search-preview-name');
        var previewText = document.getElementById('lyric-search-preview-text');
        var note = document.getElementById('lyric-search-note');
        var apply = document.getElementById('lyric-search-apply');
        var controller = null, version = 0, selected = null, armedText = null;
        function setStatus(text, error) {
            status.textContent = text; status.classList.toggle('is-error', !!error);
        }
        function cancel() {
            version++;
            if (controller) controller.abort();
            controller = null; form.setAttribute('aria-busy', 'false');
        }
        function hide() {
            if (controller) setStatus('搜索已取消，可重新搜索。');
            cancel(); panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
        }
        function clear() {
            results.replaceChildren(); preview.hidden = true; selected = null; armedText = null;
        }
        function choose(item, button) {
            selected = item; armedText = null;
            results.querySelectorAll('button').forEach(function (row) { row.setAttribute('aria-pressed', String(row === button)); });
            previewName.textContent = item.name + ' · ' + item.artist;
            previewText.textContent = item.preview;
            note.textContent = item.timed ? '时间轴来自所选版本；保存后可用现有调轴功能调整。' : '此版本只有文字，时间暂设为 00:00；保存后请从第一句开始逐句调轴。';
            apply.textContent = '填入编辑框'; preview.hidden = false;
            preview.scrollIntoView({ block: 'nearest' });
        }
        toggle.addEventListener('click', function () {
            if (!panel.hidden) { hide(); return; }
            panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); title.focus();
        });
        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            cancel(); clear();
            controller = new AbortController();
            var current = version;
            form.setAttribute('aria-busy', 'true'); setStatus('正在搜索歌词…');
            try {
                var items = await search(title.value, artist.value, controller.signal);
                if (current !== version) return;
                if (!items.length) { setStatus('没有找到可用歌词。试试简短歌名，或清空歌手后再搜。'); return; }
                setStatus('找到 ' + items.length + ' 个版本，点击查看歌词。');
                var fragment = document.createDocumentFragment();
                items.forEach(function (item) {
                    var button = document.createElement('button');
                    button.type = 'button'; button.className = 'lyric-search-result'; button.setAttribute('aria-pressed', 'false');
                    var name = document.createElement('span'); name.className = 'lyric-search-result-title'; name.textContent = item.name;
                    var meta = document.createElement('span'); meta.className = 'lyric-search-result-meta';
                    var seconds = Math.round(item.duration);
                    var duration = seconds ? Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') : '';
                    meta.textContent = [item.artist, item.album, duration, item.timed ? '带时间轴' : '纯文本 · 需调轴'].filter(Boolean).join(' · ');
                    button.append(name, meta);
                    button.addEventListener('click', function () { choose(item, button); });
                    fragment.appendChild(button);
                });
                results.appendChild(fragment);
            } catch (error) {
                if (current === version && error.name !== 'AbortError') setStatus(error.message || '搜索失败，请稍后重试。', true);
            } finally {
                if (current === version) { form.setAttribute('aria-busy', 'false'); controller = null; }
            }
        });
        apply.addEventListener('click', function () {
            if (!selected) return;
            var existing = options.getText();
            if (existing.trim() && existing !== selected.lrc && armedText !== existing) {
                armedText = existing;
                note.textContent = '编辑框已有歌词。确认替换后仍需点击“保存歌词”才会生效。';
                apply.textContent = '确认替换编辑框内容'; return;
            }
            options.onApply(selected.lrc);
            hide(); setStatus('');
            options.onApplied(selected.timed);
        });
        return {
            reset: function (name) {
                hide(); clear(); title.value = guessTitle(name); artist.value = '';
                setStatus('来源：LRCLIB。请搜索歌名，必要时填写原唱歌手。');
            },
            close: hide,
        };
    }
    global.SG_LYRIC_SEARCH = { guessTitle: guessTitle, prepareRecord: prepareRecord, search: search, create: create };
})(window);
