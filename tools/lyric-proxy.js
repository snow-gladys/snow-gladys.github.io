#!/usr/bin/env node
/**
 * 网易云歌词本地代理服务
 * 用法：node tools/lyric-proxy.js
 * 然后在浏览器打开 http://localhost:19163/lyrics.html
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 19163;
const TOOLS_DIR = __dirname;

// MIME 类型
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.lrc':  'text/plain; charset=utf-8',
  '.json': 'application/json',
};

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost');

  // ── /api/lyric?id=xxx  → 代理网易云接口 ──────────────────────────────────
  if (url.pathname === '/api/lyric') {
    const id = url.searchParams.get('id');
    if (!id || !/^\d+$/.test(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少或非法 id' }));
      return;
    }

    const target = 'https://music.163.com/api/song/media?id=' + encodeURIComponent(id);
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://music.163.com/',
      },
    };

    https.get(target, options, function (proxyRes) {
      let body = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => body += chunk);
      proxyRes.on('end', function () {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
      });
    }).on('error', function (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // ── 静态文件服务（只开放 tools/ 目录） ────────────────────────────────────
  let filePath;
  if (url.pathname === '/' || url.pathname === '/lyrics.html') {
    filePath = path.join(TOOLS_DIR, 'lyrics.html');
  } else {
    // 限制在 tools/ 目录内，防止路径穿越
    const rel = path.normalize(url.pathname).replace(/^\/+/, '');
    filePath = path.join(TOOLS_DIR, rel);
    if (!filePath.startsWith(TOOLS_DIR)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
  }

  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('');
  console.log('  ✓ 代理服务已启动');
  console.log('');
  console.log('  请在浏览器打开：http://localhost:' + PORT + '/lyrics.html');
  console.log('');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});
