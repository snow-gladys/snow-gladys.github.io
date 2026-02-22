const statusEl   = document.getElementById('status');
const outputEl   = document.getElementById('lyric-output');
const songIdLabel= document.getElementById('song-id-label');
const songNameEl = document.getElementById('song-name');
const mainUI     = document.getElementById('main-ui');
const notSong    = document.getElementById('not-song');
const filenameEl = document.getElementById('filename');

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
  statusEl.style.display = msg ? '' : 'none';
}

// 从 URL 中提取歌曲 ID（支持 ?id= 和 #/song?id= 两种格式）
function extractSongId(url) {
  const patterns = [
    /[?&]id=(\d+)/,
    /#\/song\?id=(\d+)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

// 判断是否是网易云歌曲页
function isNeteaseSongPage(url) {
  return /music\.163\.com/.test(url) && extractSongId(url) !== null;
}

// 在当前标签页执行 fetch（利用页面自身的 cookie 和域名，无跨域问题）
async function fetchLyricViaTab(tabId, songId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async function(id) {
      try {
        const res = await fetch('https://music.163.com/api/song/media?id=' + id, {
          credentials: 'include',
        });
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [songId],
  });
  return results[0]?.result;
}

// 尝试从页面 title 获取歌曲名
async function getSongName(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: function() {
        // 网易云页面 title 格式通常是 "歌名 - 歌手 - 单曲 - 网易云音乐"
        const t = document.title;
        const m = t.match(/^(.+?)\s*[-–]\s*.+?[-–]/);
        return m ? m[1].trim() : t.replace(/\s*[-–].*/,'').trim();
      },
    });
    return results[0]?.result || '';
  } catch (e) {
    return '';
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !isNeteaseSongPage(tab.url || '')) {
    notSong.style.display = '';
    return;
  }

  const songId = extractSongId(tab.url);
  mainUI.style.display = '';
  songIdLabel.textContent = 'ID: ' + songId;
  setStatus('正在获取歌词…');

  // 并行获取歌名和歌词
  const [data, name] = await Promise.all([
    fetchLyricViaTab(tab.id, songId),
    getSongName(tab.id),
  ]);

  if (name) {
    songNameEl.textContent = name;
    filenameEl.value = name;
  }

  if (!data || data.error) {
    setStatus('获取失败：' + (data?.error || '未知错误'), 'error');
    return;
  }
  if (data.code !== 200) {
    setStatus('接口返回异常 code=' + data.code, 'error');
    return;
  }
  if (!data.lyric) {
    setStatus('该歌曲暂无歌词', 'error');
    return;
  }

  outputEl.value = data.lyric.replace(/\\n/g, '\n');
  setStatus('');
}

// 去除空行
document.getElementById('btn-clear-empty').addEventListener('click', function () {
  outputEl.value = outputEl.value
    .split('\n')
    .filter(line => !/^\[\d{2}:\d{2}\.\d+\]\s*$/.test(line.trim()))
    .join('\n');
});

// 复制
document.getElementById('btn-copy').addEventListener('click', function () {
  navigator.clipboard.writeText(outputEl.value).then(() => {
    const btn = document.getElementById('btn-copy');
    const orig = btn.textContent;
    btn.textContent = '已复制 ✓';
    setTimeout(() => btn.textContent = orig, 1500);
  });
});

// 保存
document.getElementById('btn-save').addEventListener('click', function () {
  const content = outputEl.value.trim();
  if (!content) { alert('歌词内容为空'); return; }
  let name = filenameEl.value.trim() || ('lyric_' + Date.now());
  if (!name.toLowerCase().endsWith('.lrc')) name += '.lrc';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
});

init();
