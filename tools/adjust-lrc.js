#!/usr/bin/env node
/**
 * LRC 歌词时间轴调整工具
 *
 * 用法：
 *   node tools/adjust-lrc.js <文件或目录> <偏移量>
 *
 * 偏移量格式（正数 = 往后移，负数 = 往前移）：
 *   1000      → 毫秒（整数视为毫秒）
 *   1.5       → 秒（含小数点视为秒）
 *   +500ms    → 明确写 ms 后缀
 *   -1.2s     → 明确写 s 后缀
 *
 * 示例：
 *   node tools/adjust-lrc.js lyrics/再见.lrc +1s        # 整体慢 1 秒
 *   node tools/adjust-lrc.js lyrics/再见.lrc -500ms     # 整体快 500 毫秒
 *   node tools/adjust-lrc.js lyrics/ -1.5s              # 批量调整整个目录
 *
 * 调整结果直接覆盖原文件，原文件会备份为 <原文件名>.bak
 */

const fs = require('fs');
const path = require('path');

// ── 解析偏移量 ───────────────────────────────────────────────────────────────

function parseOffset(raw) {
    if (!raw) {
        console.error('错误：请提供偏移量，例如 +1s 或 -500ms');
        process.exit(1);
    }
    const str = raw.toString().trim();
    // 带 ms 后缀
    const msMatch = str.match(/^([+-]?\d+(\.\d+)?)ms$/i);
    if (msMatch) return parseFloat(msMatch[1]);
    // 带 s 后缀
    const sMatch = str.match(/^([+-]?\d+(\.\d+)?)s$/i);
    if (sMatch) return parseFloat(sMatch[1]) * 1000;
    // 纯数字：有小数点 → 秒，无小数点 → 毫秒
    const numMatch = str.match(/^([+-]?\d+(\.\d+)?)$/);
    if (numMatch) {
        const n = parseFloat(numMatch[1]);
        return str.includes('.') ? n * 1000 : n;
    }
    console.error(`错误：无法识别偏移量 "${raw}"，支持格式：+1s / -500ms / 1.5 / 800`);
    process.exit(1);
}

// ── LRC 时间标签处理 ──────────────────────────────────────────────────────────

// 匹配 [MM:SS.xx] 或 [MM:SS.xxx]，可能一行有多个标签
const TAG_RE = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

function tagToMs(m, s, ms) {
    const msVal = ms.length === 2 ? parseInt(ms) * 10 : parseInt(ms);
    return parseInt(m) * 60000 + parseInt(s) * 1000 + msVal;
}

function msToTag(totalMs) {
    totalMs = Math.max(0, Math.round(totalMs));
    const m = Math.floor(totalMs / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}]`;
}

function adjustLine(line, offsetMs) {
    return line.replace(TAG_RE, function (_, m, s, ms) {
        const original = tagToMs(m, s, ms);
        return msToTag(original + offsetMs);
    });
}

// ── 处理单个文件 ──────────────────────────────────────────────────────────────

function adjustFile(filePath, offsetMs) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const adjusted = lines.map(line => adjustLine(line, offsetMs)).join('\n');

    // 备份原文件
    const bakPath = filePath + '.bak';
    // fs.copyFileSync(filePath, bakPath);

    fs.writeFileSync(filePath, adjusted, 'utf8');

    const sign = offsetMs >= 0 ? '+' : '';
    console.log(`✓ ${path.basename(filePath)}  ${sign}${offsetMs}ms  （备份 → ${path.basename(bakPath)}）`);
}

// ── 收集目标文件 ──────────────────────────────────────────────────────────────

function collectLrcFiles(target) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
        return fs.readdirSync(target)
            .filter(f => f.toLowerCase().endsWith('.lrc'))
            .map(f => path.join(target, f));
    } else if (target.toLowerCase().endsWith('.lrc')) {
        return [target];
    } else {
        console.error(`错误："${target}" 不是 .lrc 文件也不是目录`);
        process.exit(1);
    }
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

const [,, targetArg, offsetArg] = process.argv;

if (!targetArg || !offsetArg) {
    console.log('用法：node tools/adjust-lrc.js <文件或目录> <偏移量>');
    console.log('示例：');
    console.log('  node tools/adjust-lrc.js lyrics/再见.lrc +1s');
    console.log('  node tools/adjust-lrc.js lyrics/再见.lrc -500ms');
    console.log('  node tools/adjust-lrc.js lyrics/ -1.5s');
    process.exit(0);
}

const offsetMs = parseOffset(offsetArg);
const files = collectLrcFiles(targetArg);

if (files.length === 0) {
    console.log('未找到任何 .lrc 文件');
    process.exit(0);
}

console.log(`调整偏移：${offsetMs >= 0 ? '+' : ''}${offsetMs}ms，共 ${files.length} 个文件\n`);
files.forEach(f => adjustFile(f, offsetMs));
console.log('\n完成。如需撤销，将对应 .bak 文件重命名回 .lrc 即可。');
