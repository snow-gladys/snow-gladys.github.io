const statusEl      = document.getElementById('status');
const mainUI        = document.getElementById('main-ui');
const notVideo      = document.getElementById('not-video');
const songNameInput = document.getElementById('song-name');
const bvidInput     = document.getElementById('bvid');
const playlistPath  = document.getElementById('playlist-path');
const playlistJson  = document.getElementById('playlist-json');
const btnRefresh    = document.getElementById('btn-refresh');
const btnSaveSong   = document.getElementById('btn-save-song');
const btnCopyEntry  = document.getElementById('btn-copy-entry');

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
  statusEl.style.display = msg ? '' : 'none';
}

function extractBvid(url) {
  const m = url.match(/\/video\/(BV[0-9A-Za-z]+)/);
  return m ? m[1] : '';
}

function isBilibiliVideo(url) {
  return /bilibili\.com\/video\//.test(url);
}

function buildEntryObject() {
  return {
    name: songNameInput.value.trim(),
    bvid: bvidInput.value.trim(),
  };
}

function buildEntryJson() {
  const obj = buildEntryObject();
  return JSON.stringify(obj, null, 2);
}

function renderPlaylist(songs) {
  playlistJson.value = JSON.stringify(songs, null, 2);
}

async function loadConfigAndPlaylist() {
  return new Promise(resolve => {
    chrome.storage.local.get(['bilibiliPlaylistPath', 'bilibiliPlaylistSongs'], data => {
      if (typeof data.bilibiliPlaylistPath === 'string') {
        playlistPath.value = data.bilibiliPlaylistPath;
      }
      const songs = Array.isArray(data.bilibiliPlaylistSongs) ? data.bilibiliPlaylistSongs : [];
      renderPlaylist(songs);
      resolve(songs);
    });
  });
}

function saveConfigPath() {
  const path = playlistPath.value.trim();
  chrome.storage.local.set({ bilibiliPlaylistPath: path || '' });
}

async function fetchSongNameFromPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: function () {
        try {
          const bgm = document.querySelector('.bgm-link .tag-txt');
          if (!bgm) return '';
          const text = bgm.textContent.trim();
          const m = text.match(/《(.+?)》/);
          return m ? m[1].trim() : text;
        } catch (e) {
          return '';
        }
      },
    });
    return results[0]?.result || '';
  } catch (e) {
    return '';
  }
}

async function initFromTab(tab) {
  if (!tab || !isBilibiliVideo(tab.url || '')) {
    mainUI.style.display = 'none';
    notVideo.style.display = '';
    return;
  }

  mainUI.style.display = '';
  notVideo.style.display = 'none';

  const bvid = extractBvid(tab.url || '');
  if (bvid) {
    bvidInput.value = bvid;
  }

  setStatus('正在从页面读取 BGM 歌名…');
  const name = await fetchSongNameFromPage(tab.id);
  if (name) {
    songNameInput.value = name;
    setStatus('已获取当前歌曲信息。', 'ok');
  } else {
    setStatus('未在页面中找到 bgm-link，已仅根据 URL 填充 bvid。', 'error');
  }
}

async function init() {
  setStatus('初始化中…');
  const songs = await loadConfigAndPlaylist();

  chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
    const tab = tabs[0];
    await initFromTab(tab);
    if (!songs.length) {
      setStatus('可以点击“保存到自定义歌单”开始追加条目。');
    }
  });

  playlistPath.addEventListener('change', saveConfigPath);
  playlistPath.addEventListener('blur', saveConfigPath);

  btnRefresh.addEventListener('click', async () => {
    setStatus('正在重新从页面获取…');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await initFromTab(tab);
  });

  btnCopyEntry.addEventListener('click', async () => {
    const obj = buildEntryObject();
    if (!obj.name || !obj.bvid) {
      setStatus('歌名或 bvid 为空，无法复制条目。', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(buildEntryJson());
      setStatus('已复制当前条目 JSON，可粘贴到歌单文件中。', 'ok');
    } catch (e) {
      setStatus('复制失败：' + e.message, 'error');
    }
  });

  btnSaveSong.addEventListener('click', () => {
    const entry = buildEntryObject();
    if (!entry.name || !entry.bvid) {
      setStatus('歌名和 bvid 均不能为空。', 'error');
      return;
    }
    chrome.storage.local.get(['bilibiliPlaylistSongs'], data => {
      const songs = Array.isArray(data.bilibiliPlaylistSongs) ? data.bilibiliPlaylistSongs : [];
      const exists = songs.some(s => s.bvid === entry.bvid);
      if (exists) {
        setStatus('该 bvid 已存在于自定义歌单中，如需修改请直接编辑 JSON 并手动同步到文件。', 'error');
        return;
      }
      songs.push(entry);
      chrome.storage.local.set({ bilibiliPlaylistSongs: songs }, () => {
        renderPlaylist(songs);
        setStatus('已追加到自定义歌单（保存在插件本地），记得同步到 txt 文件。', 'ok');
      });
    });
  });
}

init();

