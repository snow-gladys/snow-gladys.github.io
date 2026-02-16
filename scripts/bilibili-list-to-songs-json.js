/**
 * 哔哩哔哩歌单/合集页面 → songs.json 控制台脚本（支持过滤 + 自动翻页）
 *
 * 使用：在浏览器中打开 B 站个人空间视频列表/合集页面（或保存的 HTML），
 * 打开开发者工具 → Console，粘贴本脚本并回车。
 *
 * 配置（脚本顶部）：
 *   FILTER_TITLE：字符串。设为非空（如 '思诺'）时，仅记录标题中包含该词的视频；
 *                 设为 '' 时不过滤，本页/全部页都会记录。
 *   AUTO_PAGE：   true = 自动点击「下一页」并合并所有页结果；false = 只处理当前页。
 *
 * 输出：控制台打印未清洗/清洗后条数；最终清洗后的 JSON 会复制到剪贴板。
 * 页面结构：.list-video-item 内包含 .bili-video-card__title a（歌名）和 a[href*="/video/BV"]（含 bvid）
 */

(function () {
  // ========== 配置 ==========
  /** 过滤词：仅记录标题中包含该词的视频。留空 '' 表示不过滤。 */
  const FILTER_TITLE = '思诺';
  /** 是否自动翻页并合并所有页结果。false 则只处理当前页。 */
  const AUTO_PAGE = true;
  /** 点击「下一页」后等待加载的时间（毫秒） */
  const NEXT_PAGE_DELAY_MS = 2000;

  const BVID_REG = /\/video\/(BV[A-Za-z0-9]+)/i;

  /** 清洗标题：优先取『』中内容，否则取 / 之前的部分 */
  function cleanTitle(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    const s = raw.trim();
    let inBracket = s.match(/『([^』]*)』/);
    if (inBracket && inBracket[1]) return inBracket[1].trim();
    inBracket = s.match(/「([^」]*)」/);
    if (inBracket && inBracket[1]) return inBracket[1].trim();
    inBracket = s.match(/《([^》]*)》/);
    if (inBracket && inBracket[1]) return inBracket[1].trim();
    const idx = s.indexOf('/');
    if (idx !== -1) return s.slice(0, idx).trim();
    return s;
  }

  /** 从当前 DOM 解析一页的条目（应用 FILTER_TITLE） */
  function parseCurrentPage() {
    const items = document.querySelectorAll('.list-video-item');
    const listRaw = [];
    const listClean = [];
    const hasFilter = typeof FILTER_TITLE === 'string' && FILTER_TITLE.length > 0;

    items.forEach(function (item) {
      const titleEl = item.querySelector('.bili-video-card__title a');
      const linkEl = item.querySelector('a[href*="/video/BV"]');
      if (!titleEl || !linkEl) return;

      const name = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
      const href = linkEl.getAttribute('href') || linkEl.href || '';
      const m = href.match(BVID_REG);
      const bvid = m ? m[1] : '';

      if (!name || !bvid) return;
      if (hasFilter && !name.includes(FILTER_TITLE)) return;

      listRaw.push({ name: name, bvid: bvid });
      listClean.push({ name: cleanTitle(name), bvid: bvid });
    });

    return { raw: listRaw, clean: listClean };
  }

  /** 获取「下一页」按钮/链接（可点击且未禁用） */
  function getNextPageButton() {
    // 优先：带 pager-next 的 a/button，且父级无 is-disable
    const byClass = document.querySelector('.be-pager-next a, .be-pager-next button, [class*="pager-next"] a, [class*="pager-next"] button');
    if (byClass) {
      const parent = byClass.closest && byClass.closest('.be-pager-item');
      if (!parent || !parent.classList || !parent.classList.contains('is-disable')) return byClass;
    }
    // 兜底：文本为「下一页」的 a/button
    const nodes = document.querySelectorAll('a, button');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if ((el.textContent || '').trim() !== '下一页') continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      var p = el.parentNode;
      while (p && p !== document.body) {
        if (p.classList && p.classList.contains('is-disable')) break;
        p = p.parentNode;
      }
      if (!p || p === document.body) return el;
    }
    return null;
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /** 尝试复制到剪贴板。因权限/失焦可能失败，返回 boolean；失败时不再抛错。 */
  async function copyToClipboard(text) {
    if (typeof copy === 'function') {
      try {
        copy(text);
        return true;
      } catch (e) {
        return false;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 按 bvid 去重，保留首次出现的顺序 */
  function dedupeByBvid(list) {
    const seen = new Set();
    return list.filter(function (o) {
      const id = (o.bvid || '').toUpperCase();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  async function run() {
    const allRaw = [];
    const allClean = [];
    let pageNum = 1;

    while (true) {
      const page = parseCurrentPage();
      if (page.raw.length) {
        page.raw.forEach(function (o) { allRaw.push(o); });
        page.clean.forEach(function (o) { allClean.push(o); });
        console.log('第 ' + pageNum + ' 页解析到 ' + page.raw.length + ' 条（过滤词: ' + (FILTER_TITLE || '无') + '）');
      }

      if (!AUTO_PAGE) break;

      const nextBtn = getNextPageButton();
      if (!nextBtn) {
        console.log('未找到「下一页」或已是最后一页，停止翻页。');
        break;
      }
      nextBtn.click();
      await delay(NEXT_PAGE_DELAY_MS);
      pageNum++;
    }

    const dedupedRaw = dedupeByBvid(allRaw);
    const dedupedClean = dedupeByBvid(allClean);
    const jsonClean = JSON.stringify(dedupedClean, null, 2);

    console.log('\n共解析 ' + dedupedRaw.length + ' 条（去重后）。【未清洗 - 原始标题】');
    console.log(JSON.stringify(dedupedRaw, null, 2));

    // 暴露到全局，方便失焦时在控制台执行 copy(__bilibiliSongsJson) 手动复制
    try {
      window.__bilibiliSongsJson = jsonClean;
    } catch (e) {}

    var copied = await copyToClipboard(jsonClean);
    if (copied) {
      console.log('\n已复制到剪贴板：清洗后的 JSON（『』内或 / 前为标题）');
    } else {
      console.log('\n自动复制失败（常见原因：页面未聚焦）。请先点击页面使其聚焦，在控制台执行： copy(__bilibiliSongsJson)');
    }

    return { raw: dedupedRaw, clean: dedupedClean };
  }

  run().then(function (result) {
    console.log('脚本执行完成。', result);
  }).catch(function (err) {
    console.error('脚本执行出错：', err);
  });
})();
