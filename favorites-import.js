/* 公开收藏夹导入：先完整读取和预览，再保存用户选中的条目。 */
(function (global) {
    'use strict';
    function create(options) {
        var dialog = document.getElementById('favorites-import-dialog');
        var form = document.getElementById('favorites-read-form');
        var input = document.getElementById('favorites-source');
        var readButton = document.getElementById('favorites-read');
        var status = document.getElementById('favorites-import-status');
        var preview = document.getElementById('favorites-preview');
        var title = document.getElementById('favorites-preview-title');
        var detail = document.getElementById('favorites-preview-detail');
        var list = document.getElementById('favorites-preview-list');
        var selectAll = document.getElementById('favorites-select-all');
        var selection = document.getElementById('favorites-selection');
        var more = document.getElementById('favorites-show-more');
        var submit = document.getElementById('favorites-import-submit');
        var result = null, selected = new Set(), existing = new Set();
        var controller = null, version = 0, rendered = 0, busy = false;

        function setStatus(text, error) {
            status.textContent = text;
            status.classList.toggle('is-error', !!error);
        }
        function updateSelection() {
            var available = result ? result.items.filter(function (item) { return !existing.has(item.bvid); }).length : 0;
            selectAll.checked = available > 0 && selected.size === available;
            selectAll.indeterminate = selected.size > 0 && selected.size < available;
            selectAll.disabled = !available || busy;
            selection.textContent = '已选择 ' + selected.size + ' 项';
            submit.textContent = selected.size ? '导入 ' + selected.size + ' 项' : '导入所选';
            submit.disabled = busy || !selected.size;
        }
        function setBusy(value) {
            busy = value;
            dialog.setAttribute('aria-busy', String(value));
            readButton.disabled = value;
            readButton.textContent = value ? '读取中…' : '读取收藏夹';
            input.disabled = value;
            updateSelection();
        }
        function durationText(seconds) {
            seconds = Math.max(0, Math.floor(Number(seconds) || 0));
            var minutes = Math.floor(seconds / 60);
            var tail = String(seconds % 60).padStart(2, '0');
            return minutes >= 60 ? Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0') + ':' + tail : minutes + ':' + tail;
        }
        function appendRows() {
            var fragment = document.createDocumentFragment();
            var end = Math.min(rendered + 100, result.items.length);
            for (; rendered < end; rendered++) {
                var item = result.items[rendered];
                var duplicate = existing.has(item.bvid);
                var row = document.createElement('label');
                row.className = 'favorites-preview-row' + (duplicate ? ' is-existing' : '');
                var checkbox = document.createElement('input');
                checkbox.type = 'checkbox'; checkbox.value = item.bvid;
                checkbox.checked = selected.has(item.bvid); checkbox.disabled = duplicate;
                var copy = document.createElement('span');
                copy.className = 'favorites-row-copy';
                var name = document.createElement('span');
                name.className = 'favorites-row-title'; name.textContent = item.name;
                var meta = document.createElement('span');
                meta.className = 'favorites-row-meta';
                meta.textContent = duplicate ? '已在自定义歌单中' : [item.author, durationText(item.duration)].filter(Boolean).join(' · ');
                copy.append(name, meta); row.append(checkbox, copy); fragment.appendChild(row);
            }
            list.appendChild(fragment);
            more.hidden = rendered >= result.items.length;
            more.textContent = '再显示 100 项（已显示 ' + rendered + ' / ' + result.items.length + '）';
        }
        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (busy) return;
            if (!global.SG_BILI_API.favoriteId(input.value)) {
                setStatus('请粘贴公开收藏夹链接，或输入收藏夹编号。', true); input.focus(); return;
            }
            if (controller) controller.abort();
            controller = new AbortController();
            var current = ++version;
            result = null; selected.clear(); list.replaceChildren(); preview.hidden = true;
            setBusy(true); setStatus('正在读取公开收藏夹…');
            try {
                var data = await options.client.loadFavorites(input.value, {
                    signal: controller.signal,
                    onProgress: function (progress) {
                        if (current === version) setStatus('已读取 ' + progress.scanned + ' / ' + progress.total + ' 项…');
                    },
                });
                if (current !== version || !dialog.open) return;
                result = data;
                existing = new Set(options.getExisting().map(function (song) { return global.SG_BILI_API.normalizeId(song.bvid); }));
                selected = new Set(data.items.filter(function (item) { return !existing.has(item.bvid); }).map(function (item) { return item.bvid; }));
                title.textContent = data.title;
                var duplicates = data.items.length - selected.size + data.duplicateCount;
                detail.textContent = [data.owner, '可读取 ' + data.items.length + ' 个视频',
                    data.skipped ? '跳过 ' + data.skipped + ' 项失效或非视频内容' : '',
                    duplicates ? '跳过 ' + duplicates + ' 项重复内容' : '',
                ].filter(Boolean).join(' · ');
                rendered = 0; appendRows(); preview.hidden = false;
                setStatus(data.items.length ? '请选择要导入的内容；歌曲和普通视频都会保留原始标题。' : '这个收藏夹暂无可导入的视频。');
            } catch (error) {
                if (current === version && error.name !== 'AbortError') setStatus(error.message || '读取失败，请稍后重试。', true);
            } finally {
                if (current === version) setBusy(false);
            }
        });
        list.addEventListener('change', function (event) {
            var checkbox = event.target;
            if (!checkbox.matches('input[type="checkbox"]') || checkbox.disabled) return;
            if (checkbox.checked) selected.add(checkbox.value); else selected.delete(checkbox.value);
            updateSelection();
        });
        selectAll.addEventListener('change', function () {
            selected = new Set(selectAll.checked ? result.items.filter(function (item) { return !existing.has(item.bvid); }).map(function (item) { return item.bvid; }) : []);
            list.querySelectorAll('input[type="checkbox"]').forEach(function (checkbox) { checkbox.checked = selected.has(checkbox.value); });
            updateSelection();
        });
        more.addEventListener('click', appendRows);
        submit.addEventListener('click', async function () {
            if (busy || !result || !selected.size) return;
            var songs = result.items.filter(function (item) { return selected.has(item.bvid); });
            setBusy(true);
            try {
                var count = await options.onImport(songs);
                dialog.close();
                options.onComplete(count);
            } catch (error) { setStatus(error.message || '保存失败，请稍后重试。', true); }
            finally { setBusy(false); }
        });
        dialog.querySelectorAll('[data-close-favorites]').forEach(function (button) { button.addEventListener('click', function () { dialog.close(); }); });
        dialog.addEventListener('close', function () {
            version++;
            if (controller) controller.abort();
            setBusy(false);
        });
        return {
            open: function () {
                result = null; selected.clear(); preview.hidden = true; list.replaceChildren();
                setStatus('仅支持公开收藏夹。导入后保存在此浏览器的自定义歌单中。');
                setBusy(false); dialog.showModal(); input.focus();
            },
        };
    }
    global.SG_FAVORITES_IMPORT = { create: create };
})(window);
