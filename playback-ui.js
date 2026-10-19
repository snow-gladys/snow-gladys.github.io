/* 高频交互只绘制最新一帧；音频解码、缓存和持久化保留在播放器事件中。 */
(function (root) {
    'use strict';
    function frameTask(callback) {
        let frame = null, args;
        function run() { frame = null; const value = args; args = null; callback(...value); }
        function request(...value) { args = value; if (frame === null) frame = root.requestAnimationFrame(run); }
        request.cancel = () => { if (frame !== null) root.cancelAnimationFrame(frame); frame = null; args = null; };
        return request;
    }
    function createProgress(options) {
        const input = options.input, container = options.container;
        const fill = container.querySelector('.progress-fill'), thumb = container.querySelector('.progress-thumb');
        let frame = null, dragging = null, blockedPointer = null, width = 0, lastPaint = -Infinity, lastLyric = -Infinity;
        let text = '', total = '', aria = '', fillValue = '', thumbValue = '', homeValue = '', rangeValue = '';
        function duration(audio) { return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0; }
        function resize() { width = container.getBoundingClientRect().width; thumbValue = ''; refresh(); }
        function visible() { return !document.hidden && (options.mainVisible() || options.homeVisible()); }
        function paint(time, length) {
            const ratio = length ? Math.max(0, Math.min(1, time / length)) : 0;
            if (options.mainVisible()) {
                const current = options.format(time), end = options.format(length);
                if (text !== current) { options.current.textContent = text = current; }
                if (total !== end) { options.total.textContent = total = end; }
                const label = current + ' / ' + end;
                if (aria !== label) { input.setAttribute('aria-valuetext', aria = label); }
                const scale = 'scaleX(' + ratio.toFixed(6) + ')';
                if (fill && fillValue !== scale) { fill.style.transform = fillValue = scale; }
                const x = (ratio * width).toFixed(2) + 'px';
                if (thumb && thumbValue !== x) { thumb.style.setProperty('--thumb-x', thumbValue = x); }
                const value = (ratio * 100).toFixed(3);
                if (!dragging && rangeValue !== value) { input.value = value; rangeValue = value; }
            }
            if (options.homeVisible() && options.homeProgress) {
                const scale = 'scaleX(' + ratio.toFixed(6) + ')';
                if (homeValue !== scale) { options.homeProgress.style.transform = homeValue = scale; }
            }
        }
        function tick(timestamp) {
            frame = null;
            if (!visible()) return;
            const audio = options.audio();
            if (dragging && (audio !== dragging.audio || options.track() !== dragging.track)) cancel();
            // 拖动与主动刷新立即显示；自然播放最多 60 帧，不随 120Hz 屏幕翻倍。
            if (dragging || timestamp - lastPaint >= 1000 / 60 - 1) {
                const length = duration(audio) || (audio.duration === Infinity ? Math.max((audio.currentTime || 0) + 1, 200) : 0);
                const time = dragging ? dragging.percent / 100 * length : Math.max(0, audio.currentTime || 0);
                paint(time, length); lastPaint = timestamp;
                if (options.onTime && timestamp - lastLyric >= 50) {
                    lastLyric = timestamp; options.onTime(time);
                }
            }
            if ((!audio.paused && !audio.ended) || dragging) refresh();
        }
        function refresh() { if (frame === null && visible()) frame = root.requestAnimationFrame(tick); }
        function setDragging(value) {
            container.classList.toggle('is-scrubbing', value);
            if (options.onDragging) options.onDragging(value);
        }
        function begin(event) {
            if (dragging || blockedPointer !== null) return;
            const audio = options.audio();
            if (!duration(audio)) return;
            dragging = { audio, track: options.track(), percent: Math.max(0, Math.min(100, Number(input.value) || 0)), pointer: event && event.pointerId };
            setDragging(true);
        }
        function preview() {
            if (blockedPointer !== null) return;
            begin(); if (!dragging) return;
            dragging.percent = Math.max(0, Math.min(100, Number(input.value) || 0));
            lastPaint = -Infinity; refresh();
        }
        function finish(event) {
            if (blockedPointer !== null) { if (event && event.type === 'pointerup') blockedPointer = null; return; }
            if (!dragging || event && event.pointerId !== undefined && dragging.pointer !== undefined && event.pointerId !== dragging.pointer) return;
            const saved = dragging; dragging = null; setDragging(false);
            const audio = options.audio(), length = duration(audio);
            if (saved.audio !== audio || saved.track !== options.track() || !length) { refresh(); return; }
            const time = Math.max(0, Math.min(length, Number(input.value) / 100 * length));
            try { audio.currentTime = time; } catch (_) { refresh(); return; }
            paint(time, length); lastPaint = lastLyric = -Infinity;
            if (options.onCommit) options.onCommit();
            refresh();
        }
        function cancel(event) {
            if (event) blockedPointer = null;
            if (!dragging) return;
            if (!event && dragging.pointer !== undefined) blockedPointer = dragging.pointer;
            dragging = null; setDragging(false); lastPaint = lastLyric = -Infinity; rangeValue = '';
            refresh();
        }
        if (root.PointerEvent) {
            let trackLeft = 0, trackWidth = 0;
            function pointerPreview(event) {
                if (!dragging || dragging.pointer !== event.pointerId || !trackWidth) return;
                input.value = String(Math.max(0, Math.min(100, (event.clientX - trackLeft) / trackWidth * 100)));
                preview();
            }
            input.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                blockedPointer = null;
                begin(event);
                if (!dragging) return;
                event.preventDefault();
                input.focus({ preventScroll: true });
                const bounds = container.getBoundingClientRect(); trackLeft = bounds.left; trackWidth = bounds.width;
                try { input.setPointerCapture(event.pointerId); } catch (_) {}
                pointerPreview(event);
            });
            input.addEventListener('pointermove', pointerPreview);
            document.addEventListener('pointerup', finish);
            input.addEventListener('pointercancel', cancel);
            input.addEventListener('lostpointercapture', event => { if (dragging && event.buttons === 0) cancel(event); });
        } else {
            input.addEventListener('mousedown', begin);
            input.addEventListener('touchstart', begin, { passive: true });
            document.addEventListener('mouseup', finish);
            document.addEventListener('touchend', finish, { passive: true });
            document.addEventListener('touchcancel', cancel, { passive: true });
        }
        input.addEventListener('input', preview);
        input.addEventListener('change', finish);
        input.addEventListener('keydown', event => { if (event.key === 'Escape' && dragging) { event.preventDefault(); cancel(); } });
        input.addEventListener('blur', () => { if (dragging && dragging.pointer === undefined) finish(); });
        root.addEventListener('blur', cancel);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { cancel({ type: 'visibilitychange' }); if (frame !== null) root.cancelAnimationFrame(frame); frame = null; }
            else { lastPaint = lastLyric = -Infinity; refresh(); }
        });
        root.addEventListener('pagehide', () => { cancel({ type: 'pagehide' }); if (frame !== null) root.cancelAnimationFrame(frame); frame = null; });
        root.addEventListener('pageshow', () => { lastPaint = -Infinity; refresh(); });
        if (root.ResizeObserver) new root.ResizeObserver(resize).observe(container);
        root.addEventListener('resize', resize); resize();
        return { refresh, cancel, get dragging() { return !!dragging; },
            get time() { return dragging ? dragging.percent / 100 * duration(options.audio()) : options.audio().currentTime; } };
    }
    root.SG_PLAYBACK_UI = { frameTask, createProgress };
})(window);
