# www.snow-gladys.com

小心思胡乱做的网站qwq

致歉一切！

播放器统一在主页。左上角可以换装扮，歌单里可以整理自己想听的歌；换装扮不会切歌。

原来的思诺、心宜精选与 Live 歌库分别保留为预置歌单。心宜数据文件已移到 `catalogs/`，旧 `/fiona/` 入口由 `404.html` 跳转到主页。

自建歌单、收藏和播放记录保存在当前设备。头像在本机裁剪压缩，使用 IndexedDB 保存，每位最多一张、每张最多 512 KB；原图不上传。桌面图标不随装扮或上传头像改变。

`personal-library.js` 负责歌单存储与旧数据迁移，`library-ui.js` 对接歌单界面和播放范围，`wardrobe.js` 负责装扮与头像。默认成员图来源见 [图像说明](imgs/wardrobe/SOURCES.md)，安卓构建见 [安装包说明](android-app/README.md)。

验证：`node --test tests/*.test.mjs`。
