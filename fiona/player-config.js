/**
 * 心宜播放器配置：仅改存储 key、标题、VMID、导出文件名与歌词路径，其余逻辑复用根目录 index.js
 */
window.SG_PLAYER_CONFIG = {
    storageKeys: {
        fav: 'sg_fav_fiona',
        playMode: 'sg_play_mode_fiona',
        custom: 'sg_custom_songs_fiona'
    },
    settingsCookie: 'sg_settings_fiona',
    defaultTitle: '心宜 · Fiona',
    titleSuffix: '心宜',
    vmid: '3537115310721181',
    apiBase: 'https://snow-gladys-api-zone-3msnp1a62hlu-1304656834.eo-edgefunctions.com',
    version: '0.0.9(测)',
    exportFilename: 'custom_songs_xinyi.txt',
    lyricsBasePath: '../lyrics/'
};
