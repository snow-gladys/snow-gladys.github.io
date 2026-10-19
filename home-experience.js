/* 首页开屏：只绘制 780ms，文字采样最多 900 点，结束即释放画布。 */
(function () {
    'use strict';
    const title = document.querySelector('.clean-title'), subtitle = document.querySelector('.clean-subtitle');
    if (title && window.SG_WARDROBE) title.textContent = SG_WARDROBE.profile(SG_WARDROBE.selected).name;
    if (!title || !subtitle || document.hidden || !matchMedia('(pointer: coarse), (max-width: 768px)').matches ||
        matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    requestAnimationFrame(() => {
        if (document.hidden || document.querySelector('dialog[open]')) return;
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
        let frame = null, started = null, finished = false, lastProgress = 0, fastStart = null, fastFrom = 0;
        function skip() { if (fastStart === null) { fastStart = performance.now(); fastFrom = lastProgress; } }
        function stop() {
            if (finished) return; finished = true;
            cancelAnimationFrame(frame); canvas.remove(); document.body.classList.remove('has-home-intro');
            window.removeEventListener('pointerdown', skip, true);
            for (const type of ['visibilitychange', 'resize']) window.removeEventListener(type, stop, true);
            window.removeEventListener('sg:appearance', appearance);
            canvas.width = canvas.height = sample.width = sample.height = 0;
        }
        const nameAtStart = title.textContent;
        function appearance() { if (title.textContent !== nameAtStart) stop(); }
        window.addEventListener('sg:appearance', appearance);
        window.addEventListener('pointerdown', skip, true);
        for (const type of ['visibilitychange', 'resize']) window.addEventListener(type, stop, true);
        document.body.appendChild(canvas); document.body.classList.add('has-home-intro');
        const timeout = setTimeout(stop, 1000);
        function draw(now) {
            if (finished) { clearTimeout(timeout); return; }
            if (started === null) started = now;
            const progress = fastStart === null ? Math.min(1, (now - started) / 780) : Math.min(1, fastFrom + (1 - fastFrom) * (now - fastStart) / 150);
            lastProgress = progress;
            const ease = 1 - Math.pow(1 - Math.min(1, progress / .78), 3);
            if (progress >= 1) { clearTimeout(timeout); stop(); return; }
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = '#111'; ctx.globalAlpha = Math.min(1, progress * 8) * (progress > .78 ? (1 - progress) / .22 : 1);
            for (const point of points) ctx.fillRect(point.sx + (point.x - point.sx) * ease, point.sy + (point.y - point.sy) * ease, 1.8, 1.8);
            title.style.setProperty('--intro-reveal', Math.max(0, (progress - .68) / .25));
            subtitle.style.setProperty('--intro-reveal', Math.max(0, (progress - .68) / .25));
            frame = requestAnimationFrame(draw);
        }
        frame = requestAnimationFrame(draw);
    });
})();
