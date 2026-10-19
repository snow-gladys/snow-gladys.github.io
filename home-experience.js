/* 首页开屏约 2 秒：聚合、短暂停留、淡入文字；恢复主屏幕应用时也可播放。 */
(function () {
    'use strict';
    const title = document.querySelector('.clean-title'), subtitle = document.querySelector('.clean-subtitle');
    if (!title || !subtitle) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let active = null, queued = null, hasPlayed = false, interrupted = false, hiddenAt = document.hidden ? Date.now() : 0;
    function schedule() {
        if (active || queued !== null || document.hidden || motion.matches ||
            !matchMedia('(pointer: coarse), (max-width: 768px)').matches) return;
        queued = requestAnimationFrame(() => {
            queued = null;
            const home = document.querySelector('#view-home');
            if (document.hidden || motion.matches || document.querySelector('dialog[open]') || home && home.style.display === 'none') return;
            if (window.SG_WARDROBE) title.textContent = SG_WARDROBE.profile(SG_WARDROBE.selected).name;
            play();
        });
    }
    function play() {
        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.className = 'home-intro'; canvas.setAttribute('aria-hidden', 'true');
        const width = innerWidth, height = innerHeight, dpr = Math.min(devicePixelRatio || 1, 1.5);
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.scale(dpr, dpr);
        const sample = document.createElement('canvas'); sample.width = width; sample.height = height;
        const pen = sample.getContext('2d', { willReadFrequently: true }); if (!pen) return;
        pen.fillStyle = '#111';
        for (const element of [title, subtitle]) {
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            pen.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
            pen.textBaseline = 'middle';
            const text = element.textContent.trim().replace(/\s+/g, ' '), chars = Array.from(text);
            const spacing = parseFloat(style.letterSpacing) || 0;
            const textWidth = pen.measureText(text).width + spacing * (chars.length - 1);
            let x = rect.left + (rect.width - textWidth) / 2;
            for (const char of chars) { pen.fillText(char, x, rect.top + rect.height / 2); x += pen.measureText(char).width + spacing; }
        }
        const pixels = pen.getImageData(0, 0, width, height).data, targets = [];
        for (let y = 0; y < height; y += 3) for (let x = 0; x < width; x += 3) {
            if (pixels[(y * width + x) * 4 + 3] > 100) targets.push({ x, y });
        }
        if (!targets.length) return;
        const stride = Math.max(1, Math.ceil(targets.length / 900));
        const points = targets.filter((_, i) => i % stride === 0).map(point => ({ ...point,
            sx: point.x + (Math.random() - .5) * 180, sy: point.y + (Math.random() - .5) * 100 }));
        let frame = null, started = null, finished = false, lastProgress = 0, fastStart = null, fastFrom = 0, timeout;
        function skip() { if (fastStart === null) { fastStart = performance.now(); fastFrom = lastProgress; } }
        function stop() {
            if (finished) return; finished = true;
            cancelAnimationFrame(frame); clearTimeout(timeout); canvas.remove(); document.body.classList.remove('has-home-intro');
            window.removeEventListener('pointerdown', skip, true);
            window.removeEventListener('resize', resize);
            window.removeEventListener('sg:appearance', appearance);
            canvas.width = canvas.height = sample.width = sample.height = 0;
            active = null;
        }
        // iOS 冷启动和浏览器工具栏会改变高度，不把这些变化当成用户退出开屏。
        function resize() { if (Math.abs(innerWidth - width) > 32) stop(); }
        const nameAtStart = title.textContent;
        function appearance() { if (title.textContent !== nameAtStart) skip(); }
        window.addEventListener('sg:appearance', appearance);
        window.addEventListener('pointerdown', skip, true);
        window.addEventListener('resize', resize);
        title.style.setProperty('--intro-reveal', 0); subtitle.style.setProperty('--intro-reveal', 0);
        document.body.appendChild(canvas); document.body.classList.add('has-home-intro');
        active = stop;
        timeout = setTimeout(stop, 2300);
        function draw(now) {
            if (finished) return;
            if (started === null) started = now;
            const progress = fastStart === null ? Math.min(1, (now - started) / 2000) : Math.min(1, fastFrom + (1 - fastFrom) * (now - fastStart) / 150);
            lastProgress = progress;
            const gather = Math.min(1, progress / .72), ease = gather * gather * (3 - 2 * gather);
            if (progress >= 1) { stop(); return; }
            hasPlayed = true;
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = '#111'; ctx.globalAlpha = Math.min(1, progress * 12) * (progress > .84 ? (1 - progress) / .16 : 1);
            for (const point of points) ctx.fillRect(point.sx + (point.x - point.sx) * ease, point.sy + (point.y - point.sy) * ease, 2, 2);
            const reveal = Math.min(1, Math.max(0, (progress - .84) / .16));
            title.style.setProperty('--intro-reveal', reveal); subtitle.style.setProperty('--intro-reveal', reveal);
            frame = requestAnimationFrame(draw);
        }
        frame = requestAnimationFrame(draw);
    }
    function hide() {
        hiddenAt = Date.now(); interrupted = interrupted || !!active || queued !== null;
        if (queued !== null) { cancelAnimationFrame(queued); queued = null; }
        if (active) active();
    }
    function visible() {
        if (document.hidden) { hide(); return; }
        const reopen = !hasPlayed || interrupted || hiddenAt > 0 && Date.now() - hiddenAt >= 1500;
        hiddenAt = 0; interrupted = false;
        if (reopen) schedule();
    }
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', event => { if (event.persisted || !hasPlayed) schedule(); });
    if (motion.addEventListener) motion.addEventListener('change', () => { if (motion.matches && active) active(); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
    else schedule();
})();
