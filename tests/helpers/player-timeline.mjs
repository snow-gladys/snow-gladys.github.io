import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
export function installTimeline(context, player = read('index.js')) {
    context.window ||= {};
    vm.runInContext(read('bili-api.js'), context);
    vm.runInContext(read('playback-state.js'), context);
    const start = player.indexOf('        let fragmentEndedFor =');
    const end = player.indexOf('        // ── 播放页 / 歌词页频谱', start);
    vm.runInContext(player.slice(start, end), context);
}
