// 手机端用一张小画布绘制，避免为每根柱子维护合成图层。
(function (root) {
    'use strict';
    function isIOS(nav) {
        return /iPad|iPhone|iPod/.test(nav.userAgent || '') ||
            (/Macintosh/.test(nav.userAgent || '') && nav.maxTouchPoints > 1);
    }
    function create(element) {
        const canvas = document.createElement('canvas');
        canvas.className = 'mobile-spectrum';
        canvas.setAttribute('aria-hidden', 'true');
        element.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        let width = 0, height = 0, count = 0, levels = [], envelopes = [], ranges = [];
        let bins = 0, phase = 0, previousTime = null;
        function resize() {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) return false;
            if (width === rect.width && height === rect.height) return true;
            width = rect.width; height = rect.height;
            // 限制像素密度，避免高分辨率手机把背景装饰绘制成大图。
            const ratio = Math.min(root.devicePixelRatio || 1, 1.5);
            canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
            if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            count = Math.max(12, Math.min(48, Math.floor(width / 5)));
            levels = new Float32Array(count);
            envelopes = Array.from({ length: count }, (_, i) => 0.02 + 0.98 * Math.sin(Math.PI * i / (count - 1)));
            bins = 0;
            return true;
        }
        resize();
        if (root.ResizeObserver) new root.ResizeObserver(resize).observe(element);
        function draw(data, time, playing, lyrics) {
            if (!ctx || (!width && !resize())) return;
            const mode = data ? 'realtime' : 'ambient';
            if (element.dataset.spectrumMode !== mode) element.dataset.spectrumMode = mode;
            // 装饰模式只在真正播放时推进，不读取、解码或额外下载音频。
            if (previousTime !== null && playing) phase += Math.min(80, Math.max(0, time - previousTime)) / 1000;
            previousTime = playing ? time : null;
            if (data && bins !== data.length) {
                bins = data.length;
                const useful = Math.max(1, Math.floor(bins * 0.35));
                ranges = Array.from({ length: count }, (_, i) => {
                    const start = Math.floor(i * useful / count);
                    return [start, Math.min(bins, Math.max(start + 1, Math.floor((i + 1) * useful / count)))];
                });
            }
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = '#000';
            const step = width / count, barWidth = Math.min(3, step * 0.6);
            for (let i = 0; i < count; i++) {
                let value = 0;
                if (playing && data) {
                    const [start, end] = ranges[i];
                    for (let j = start; j < end; j++) value += data[j];
                    value = Math.pow(value / (end - start) / 255, 1.4);
                } else if (playing) {
                    value = 0.13 + 0.26 * Math.pow((1 + Math.sin(phase * 2.8 + i * 0.48)) / 2, 2) +
                        0.18 * Math.pow((1 + Math.sin(phase * 4.1 - i * 0.29)) / 2, 2);
                }
                const target = playing ? value * envelopes[i] * (lyrics ? 1.6 : 1.1) : 0;
                levels[i] += (target - levels[i]) * (target > levels[i] ? 0.65 : 0.3);
                const h = Math.max(1, Math.min(height, levels[i] * height));
                ctx.fillRect(i * step + (step - barWidth) / 2, height - h, barWidth, h);
            }
        }
        function reset() {
            levels.fill(0); previousTime = null;
            draw(null, 0, false, false);
        }
        return { canvas, draw, resize, reset };
    }
    root.SG_MOBILE_VISUALIZER = { create, isIOS };
})(window);
