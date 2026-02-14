/**
 * 哔哩哔哩歌单/合集页面 → songs.json 控制台脚本
 *
 * 使用：在浏览器中打开「思诺snow的个人空间」合集/列表页面（或保存的 HTML），
 * 打开开发者工具 → Console，粘贴本脚本并回车。
 * - 控制台打印：未清洗的原始标题（以防万一）
 * - 复制到剪贴板：清洗后的标题（『』内为标题，否则 / 之前为标题）
 *
 * 页面结构：.list-video-item 内包含 .bili-video-card__title a（歌名）和 a[href*="/video/BV"]（含 bvid）
 */

(function () {
  const BVID_REG = /\/video\/(BV[A-Za-z0-9]+)/i;

  /** 清洗标题：优先取『』中内容，否则取 / 之前的部分 */
  function cleanTitle(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    const s = raw.trim();
    inBracket = s.match(/『([^』]*)』/);
    if (inBracket && inBracket[1]) return inBracket[1].trim();
    inBracket = s.match(/「([^」]*)」/);
    if (inBracket && inBracket[1]) return inBracket[1].trim();
    inBracket = s.match(/《([^》]*)》/);
    if (inBracket && inBracket[1]) return inBracket[1].trim();
    const idx = s.indexOf('/');
    if (idx !== -1) return s.slice(0, idx).trim();
    return s;
  }

  const items = document.querySelectorAll('.list-video-item');
  const listRaw = [];
  const listClean = [];

  items.forEach(function (item) {
    const titleEl = item.querySelector('.bili-video-card__title a');
    const linkEl = item.querySelector('a[href*="/video/BV"]');
    if (!titleEl || !linkEl) return;

    const name = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
    const href = linkEl.getAttribute('href') || linkEl.href || '';
    const m = href.match(BVID_REG);
    const bvid = m ? m[1] : '';

    if (name && bvid) {
      listRaw.push({ name: name, bvid: bvid });
      listClean.push({ name: cleanTitle(name), bvid: bvid });
    }
  });

  const jsonRaw = JSON.stringify(listRaw, null, 2);
  const jsonClean = JSON.stringify(listClean, null, 2);

  console.log('共解析 ' + listRaw.length + ' 条。\n【未清洗 - 原始标题】\n');
  console.log(jsonRaw);

  if (typeof copy === 'function') {
    copy(jsonClean);
    console.log('\n已复制到剪贴板：清洗后的 JSON（『』内或 / 前为标题）');
  } else {
    try {
      navigator.clipboard.writeText(jsonClean).then(function () {
        console.log('\n已复制到剪贴板：清洗后的 JSON');
      }).catch(function () {
        console.log('\n请手动复制上面「未清洗」的 JSON，或自行清洗后粘贴到 songs.json');
      });
    } catch (e) {
      console.log('\n请手动复制上面「未清洗」的 JSON，或自行清洗后粘贴到 songs.json');
    }
  }

  return { raw: listRaw, clean: listClean };
})();
