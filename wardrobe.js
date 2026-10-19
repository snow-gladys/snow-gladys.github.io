/* 五套装扮共用一个播放器。头像仅在本机裁剪、压缩并存入 IndexedDB。 */
(function (root) {
    'use strict';
    const MAX_BYTES = 512 * 1024, MAX_INPUT_BYTES = 12 * 1024 * 1024;
    const profiles = [
        { id: 'gladys', name: '思诺 Gladys', short: '思诺', color: '#00f3ff', rgb: '0, 243, 255', vmid: '3537115310721781', image: 'imgs/snow_char.webp', position: '50% 50%' },
        { id: 'fiona', name: '心宜 Fiona', short: '心宜', color: '#f472a8', rgb: '244, 114, 168', vmid: '3537115310721181', image: 'imgs/xinyi_char.webp', position: '50% 50%' },
        { id: 'diana', name: '嘉然 Diana', short: '嘉然', color: '#E799B0', rgb: '231, 153, 176', vmid: '672328094', image: 'imgs/wardrobe/diana.webp', position: '65% 50%' },
        { id: 'eileen', name: '乃琳 Eileen', short: '乃琳', color: '#576690', rgb: '87, 102, 144', vmid: '672342685', image: 'imgs/wardrobe/eileen.webp', position: '65% 50%' },
        { id: 'bella', name: '贝拉 Bella', short: '贝拉', color: '#DB7D74', rgb: '219, 125, 116', vmid: '672353429', image: 'imgs/wardrobe/bella.webp', position: '65% 50%' },
    ];
    let selected = 'gladys', dbPromise = null;
    const avatars = new Map();
    const artworkCache = new Map();
    function profile(id) { return profiles.find(item => item.id === id) || profiles[0]; }
    function cropRect(width, height, zoom, x, y) {
        const side = Math.min(width, height) / Math.max(1, Math.min(3, Number(zoom) || 1));
        return { x: Math.max(0, Math.min(1, Number(x) || 0)) * (width - side),
            y: Math.max(0, Math.min(1, Number(y) || 0)) * (height - side), side };
    }
    function database() {
        if (!root.indexedDB) return Promise.reject(new Error('当前浏览器无法保存头像，请检查存储权限。'));
        if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('sg_wardrobe', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('avatars', { keyPath: 'id' });
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => { db.close(); dbPromise = null; };
                resolve(db);
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('请先关闭其他播放器页面后重试。'));
        }).catch(error => { dbPromise = null; throw error; });
        return dbPromise;
    }
    async function writeAvatar(id, blob) {
        if (!profiles.some(item => item.id === id) || blob && (!(blob instanceof Blob) || blob.size > MAX_BYTES || !['image/webp', 'image/jpeg'].includes(blob.type))) throw new Error('头像格式不支持或超过 512 KB。');
        // 部分 WebKit 环境无法可靠写入 Blob，保存为二进制缓冲区，读取时再还原图片。
        const bytes = blob ? await blob.arrayBuffer() : null;
        const db = await database();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('avatars', 'readwrite');
            if (blob) tx.objectStore('avatars').put({ id, bytes, type: blob.type }); else tx.objectStore('avatars').delete(id);
            tx.oncomplete = resolve;
            tx.onerror = tx.onabort = () => reject(tx.error || new Error('头像保存失败，请检查设备空间后重试。'));
        });
        const previous = avatars.get(id);
        if (blob) avatars.set(id, URL.createObjectURL(blob)); else avatars.delete(id);
        apply(); renderCards();
        if (previous) URL.revokeObjectURL(previous);
    }
    async function loadAvatars() {
        const db = await database();
        const rows = await new Promise((resolve, reject) => {
            const tx = db.transaction('avatars', 'readonly'), request = tx.objectStore('avatars').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        for (const row of rows) {
            if (!profiles.some(item => item.id === row.id)) continue;
            const blob = row.bytes instanceof ArrayBuffer && row.bytes.byteLength <= MAX_BYTES && ['image/webp', 'image/jpeg'].includes(row.type)
                ? new Blob([row.bytes], { type: row.type }) : row.blob;
            if (blob instanceof Blob && blob.size > 0 && blob.size <= MAX_BYTES && ['image/webp', 'image/jpeg'].includes(blob.type)) avatars.set(row.id, URL.createObjectURL(blob));
        }
        apply(); renderCards();
    }
    function image(id) { return avatars.get(id) || profile(id).image; }
    function artwork() {
        const cached = artworkCache.get(selected);
        return cached && cached.source === image(selected) && cached.result ? cached.result : [];
    }
    function refreshArtwork(item) {
        const source = image(item.id), previous = artworkCache.get(item.id);
        if (previous && previous.source === source) return;
        const entry = { source, result: null }; artworkCache.set(item.id, entry);
        const portrait = new Image();
        portrait.onload = () => {
            if (artworkCache.get(item.id) !== entry) return;
            try {
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
                const ctx = canvas.getContext('2d');
                const position = avatars.has(item.id) ? [0.5, 0.5] : item.position.split(' ').map(value => parseFloat(value) / 100);
                const rect = cropRect(portrait.naturalWidth, portrait.naturalHeight, 1, position[0], position[1]);
                ctx.fillStyle = '#fafafc'; ctx.fillRect(0, 0, 512, 512);
                ctx.drawImage(portrait, rect.x, rect.y, rect.side, rect.side, 0, 0, 512, 512);
                // 独立于临时头像 Blob 的方形 JPEG，不会在换图后因 URL 被回收而失效。
                entry.result = [{ src: canvas.toDataURL('image/jpeg', 0.9), sizes: '512x512', type: 'image/jpeg' }];
                if (selected === item.id) root.dispatchEvent(new CustomEvent('sg:artwork'));
            } catch (_) { artworkCache.delete(item.id); }
        };
        portrait.onerror = () => { if (artworkCache.get(item.id) === entry) artworkCache.delete(item.id); };
        portrait.src = source;
    }
    function apply() {
        if (!root.document) return;
        const item = profile(selected), css = document.documentElement.style;
        css.setProperty('--neon-blue', item.color);
        css.setProperty('--neon-blue-rgb', item.rgb);
        css.setProperty('--neon-blue-soft', 'rgba(' + item.rgb + ', 0.08)');
        css.setProperty('--theme-pink', item.color);
        css.setProperty('--img-character', 'url(' + JSON.stringify(image(item.id)) + ')');
        css.setProperty('--portrait-position', avatars.has(item.id) ? '50% 50%' : item.position);
        document.documentElement.dataset.appearance = item.id;
        const name = document.querySelector('.clean-title');
        if (name) name.textContent = item.name;
        root.dispatchEvent(new CustomEvent('sg:appearance', { detail: { ...item } }));
        refreshArtwork(item);
    }
    function select(id) {
        if (!profiles.some(item => item.id === id)) return false;
        try { localStorage.setItem('sg_wardrobe_selected', id); }
        catch (_) { status('本次装扮已应用，浏览器未允许保存，下次打开可能恢复默认。'); }
        selected = id; apply(); renderCards(); return true;
    }
    function status(message, error) {
        const el = document.getElementById('wardrobe-status');
        if (el) { el.textContent = message; el.classList.toggle('is-error', !!error); }
    }
    function renderCards() {
        const grid = document.getElementById('wardrobe-grid');
        if (!grid || !document.getElementById('wardrobe-dialog').open && !grid.childElementCount) return;
        // 保留焦点与滚动位置，切换头像时只更新已有卡片。
        if (!grid.childElementCount) for (const item of profiles) {
            const card = document.createElement('article'); card.className = 'wardrobe-card'; card.dataset.profile = item.id;
            card.style.setProperty('--profile-color', item.color);
            const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'wardrobe-choice'; choose.dataset.wardrobeSelect = item.id;
            const portrait = document.createElement('img'); portrait.alt = ''; portrait.width = 80; portrait.height = 80; portrait.decoding = 'async';
            const name = document.createElement('strong'); name.textContent = item.name;
            const mark = document.createElement('span'); mark.className = 'wardrobe-selected'; mark.textContent = '使用中';
            choose.append(portrait, name, mark);
            const controls = document.createElement('div'); controls.className = 'wardrobe-card-actions';
            const upload = document.createElement('button'); upload.type = 'button'; upload.textContent = '换头像'; upload.dataset.wardrobeUpload = item.id; upload.setAttribute('aria-label', '更换' + item.short + '的头像');
            const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = '恢复默认'; restore.dataset.wardrobeRestore = item.id; restore.setAttribute('aria-label', '恢复' + item.short + '的默认头像');
            controls.append(upload, restore); card.append(choose, controls); grid.append(card);
        }
        for (const item of profiles) {
            const card = grid.querySelector('[data-profile="' + item.id + '"]');
            const portrait = card.querySelector('img');
            if (portrait.getAttribute('src') !== image(item.id)) portrait.src = image(item.id);
            portrait.style.objectPosition = avatars.has(item.id) ? '50% 50%' : item.position;
            card.querySelector('.wardrobe-choice').setAttribute('aria-pressed', String(selected === item.id));
            card.querySelector('[data-wardrobe-restore]').disabled = !avatars.has(item.id);
        }
    }
    let inputTarget = null, cropImage = null, cropUrl = null, cropTarget = null, busy = false, editVersion = 0;
    const crop = { zoom: 1, x: 0.5, y: 0.5 };
    function drawCrop() {
        if (!cropImage) return;
        const canvas = document.getElementById('avatar-crop-canvas'), context = canvas.getContext('2d');
        const rect = cropRect(cropImage.naturalWidth, cropImage.naturalHeight, crop.zoom, crop.x, crop.y);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(cropImage, rect.x, rect.y, rect.side, rect.side, 0, 0, canvas.width, canvas.height);
        for (const key of ['zoom', 'x', 'y']) document.getElementById('avatar-crop-' + key).value = crop[key];
    }
    function closeCrop() {
        if (busy) return;
        editVersion++;
        const dialog = document.getElementById('avatar-crop-dialog');
        if (dialog.open) dialog.close();
        if (cropUrl) URL.revokeObjectURL(cropUrl);
        cropUrl = null; cropImage = null; cropTarget = null;
    }
    async function openCrop(file, id) {
        if (!file) return;
        if (file.size > MAX_INPUT_BYTES) { status('原图请控制在 12 MB 以内。裁剪后会自动压缩至 512 KB 内。', true); return; }
        if (!/^image\//.test(file.type) || /svg/.test(file.type)) { status('请选择照片格式的图片，例如 JPG、PNG 或 WebP。', true); return; }
        closeCrop();
        const version = ++editVersion, url = URL.createObjectURL(file), picture = new Image();
        picture.src = url;
        try { await picture.decode(); }
        catch (_) { URL.revokeObjectURL(url); status('无法读取这张图片，请换一张 JPG、PNG 或 WebP 图片。', true); return; }
        if (version !== editVersion) { URL.revokeObjectURL(url); return; }
        if (!picture.naturalWidth || !picture.naturalHeight || picture.naturalWidth * picture.naturalHeight > 36000000) { URL.revokeObjectURL(url); status('图片尺寸过大，请先缩小到 3600 万像素以内。', true); return; }
        cropImage = picture; cropUrl = url; cropTarget = id;
        Object.assign(crop, { zoom: 1, x: 0.5, y: 0.5 });
        document.getElementById('avatar-crop-heading').textContent = '裁剪 · ' + profile(id).short;
        document.getElementById('avatar-crop-status').textContent = '拖动图片调整位置，也可以用下面的滑块微调。';
        drawCrop(); document.getElementById('avatar-crop-dialog').showModal();
    }
    async function encodeCrop() {
        const rect = cropRect(cropImage.naturalWidth, cropImage.naturalHeight, crop.zoom, crop.x, crop.y);
        const canvas = document.createElement('canvas');
        try {
            for (const size of [1024, 768, 512]) {
                canvas.width = canvas.height = Math.min(size, Math.floor(rect.side));
                const context = canvas.getContext('2d');
                context.fillStyle = '#fafafc'; context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(cropImage, rect.x, rect.y, rect.side, rect.side, 0, 0, canvas.width, canvas.height);
                for (const quality of [0.86, 0.7, 0.54]) {
                    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
                    if (!blob || blob.type !== 'image/webp') blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
                    if (blob && blob.size <= MAX_BYTES) return blob;
                }
            }
            throw new Error('图片未能压缩到 512 KB，请换一张图片试试。');
        } finally { canvas.width = canvas.height = 1; }
    }
    function initialize() {
        apply(); renderCards();
        const dialog = document.getElementById('wardrobe-dialog'), input = document.getElementById('wardrobe-file-input');
        document.getElementById('btn-wardrobe').addEventListener('click', () => { status('每位可保存一张头像，仅存在此设备；裁剪后每张不超过 512 KB。'); dialog.showModal(); renderCards(); });
        dialog.querySelector('[data-close-wardrobe]').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', async event => {
            const choose = event.target.closest('[data-wardrobe-select]');
            if (choose) select(choose.dataset.wardrobeSelect);
            const upload = event.target.closest('[data-wardrobe-upload]');
            if (upload) { inputTarget = upload.dataset.wardrobeUpload; input.value = ''; input.click(); }
            const restore = event.target.closest('[data-wardrobe-restore]');
            if (restore) {
                restore.disabled = true;
                try { await writeAvatar(restore.dataset.wardrobeRestore, null); status('已恢复默认头像。'); }
                catch (error) { status(error.message || '恢复失败，请重试。', true); renderCards(); }
            }
        });
        input.addEventListener('change', () => openCrop(input.files[0], inputTarget));
        const cropDialog = document.getElementById('avatar-crop-dialog'), canvas = document.getElementById('avatar-crop-canvas');
        let pointer = null;
        canvas.addEventListener('pointerdown', event => {
            if (busy || !cropImage || pointer) return;
            pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId);
        });
        canvas.addEventListener('pointermove', event => {
            if (!pointer || pointer.id !== event.pointerId || !cropImage || busy) return;
            const rect = cropRect(cropImage.naturalWidth, cropImage.naturalHeight, crop.zoom, crop.x, crop.y);
            const scale = rect.side / canvas.getBoundingClientRect().width;
            const dx = cropImage.naturalWidth - rect.side, dy = cropImage.naturalHeight - rect.side;
            if (dx > 0) crop.x = Math.max(0, Math.min(1, crop.x - (event.clientX - pointer.x) * scale / dx));
            if (dy > 0) crop.y = Math.max(0, Math.min(1, crop.y - (event.clientY - pointer.y) * scale / dy));
            pointer.x = event.clientX; pointer.y = event.clientY; drawCrop();
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => { pointer = null; });
        for (const key of ['zoom', 'x', 'y']) document.getElementById('avatar-crop-' + key).addEventListener('input', event => { if (!busy) { crop[key] = Number(event.target.value); drawCrop(); } });
        cropDialog.querySelector('[data-close-crop]').addEventListener('click', closeCrop);
        cropDialog.addEventListener('cancel', event => { event.preventDefault(); closeCrop(); });
        cropDialog.addEventListener('close', () => { if (!busy && cropUrl) closeCrop(); });
        document.getElementById('avatar-crop-save').addEventListener('click', async event => {
            if (busy || !cropImage) return;
            busy = true; const button = event.currentTarget; button.disabled = true; button.textContent = '正在压缩保存…';
            const controls = [...cropDialog.querySelectorAll('input, [data-close-crop]')]; controls.forEach(control => { control.disabled = true; });
            try {
                const blob = await encodeCrop(); await writeAvatar(cropTarget, blob);
                busy = false; closeCrop(); status('头像已保存（' + Math.ceil(blob.size / 1024) + ' KB），仅保存在此设备。');
            } catch (error) { document.getElementById('avatar-crop-status').textContent = error.message || '保存失败，请重试。'; }
            finally { busy = false; button.disabled = false; button.textContent = '保存头像'; controls.forEach(control => { control.disabled = false; }); }
        });
        loadAvatars().catch(() => { /* 默认装扮仍然可用，保存时再显示存储错误。 */ });
    }
    root.SG_WARDROBE = { profiles, profile, get selected() { return selected; }, image, artwork, select, cropRect, MAX_BYTES, MAX_INPUT_BYTES };
    if (!root.document) return;
    try {
        const url = new URL(location.href), saved = localStorage.getItem('sg_wardrobe_selected');
        selected = profiles.some(item => item.id === saved) ? saved : 'gladys';
        if (url.searchParams.get('from') === 'fiona') {
            selected = 'fiona'; localStorage.setItem('sg_wardrobe_selected', selected);
            url.searchParams.delete('from'); history.replaceState(null, '', url);
        }
    } catch (_) {}
    apply();
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
})(typeof window === 'undefined' ? globalThis : window);
