# 音视频附件预览

项目附件上传音频或视频后，使用现有“预览”入口打开。播放器支持中文控件、暂停、拖动、音量、倍速和视频全屏，并随系统主题、字号与窗口宽度调整。关闭预览或切换项目即停止播放。

浏览器能解码的文件优先直接播放；不兼容时，由运行项目系统的电脑准备兼容副本。准备完成后可继续播放，失败时可明确重试或下载原件。组件随成品离线提供，媒体不上传第三方服务。外链和手机仍需能够连接运行系统并正常登录。

PDF 使用完整 PDF.js 阅读器，支持自带书签、缩略图、页码、文字搜索和用户主动打印；无文字层扫描件不提供 OCR。Word、Excel 保留原有组件。SumatraPDF 仅适用 Windows，可通过电脑的默认应用关联作为外部阅读器，不能覆盖网页和手机，也不提供 Word、Excel 预览，因此没有整体替换现有预览。

## 组件和构建

- Video.js 10.2.0，Apache-2.0，自托管完整官方 `@videojs/cdn` 发行目录，包含中文与 HLS 相对依赖。
- FFmpeg 9.0.2，本地独立 CLI，配置为 LGPL-2.1-or-later，禁用 GPL、version3、nonfree 和网络；对应源码、许可及固定构建配方见完整包的 `第三方组件/媒体引擎源码与构建`。
- 固定二进制、源码与文件清单见 `static/libs/media-engine/PROVENANCE.json` 和 `engine-manifest.json`；构建完成后将归档内每份媒体资源与批准哈希再核对，禁止校验后修改输入仍通过。
- 兼容视频使用 Windows Media Foundation H.264 与 AAC，Windows 需有对应系统媒体组件。实际支持取决于编码、文件完整性及环境；不宣称所有文件均可播放。

成品验收命令及范围见 [本机成品媒体验收](../tools/README-media-release.md)。本机无头浏览器的手机宽度模拟不代替真实手机、原生 WebView 或外网访问；这些项目应在部署环境按实际设备验收。

## 官方来源

[Video.js 10.2.0](https://github.com/videojs/video.js/releases/tag/video.js%4010.2.0)、[FFmpeg](https://ffmpeg.org/download.html)、[固定媒体引擎构建](media-engine-build.md)、[SumatraPDF 支持格式](https://www.sumatrapdfreader.org/docs/Supported-document-formats)。Plyr 官方已进入弃用及仅安全维护状态，本实现选择其官方推荐的 Video.js。
