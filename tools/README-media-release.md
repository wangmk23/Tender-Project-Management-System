# 本机成品媒体验收

`verify_media_release.py` 对两个明确 SHA256 的 Windows EXE 做隔离验收。依赖现有 `owned_client`、`PackagedClient` 和本机无头 Chromium，不启动源码 HTTP 服务，不读取现有部署的数据库、许可证、密钥、邮箱或附件，也不替换在用程序。

流程先让基线 EXE 使用临时自建许可、创建合成项目、真正上传并加密保存 PDF；关闭该隔离进程后，把同一合成数据复制给候选 EXE，检查旧附件下载字节保持一致。WAV 与 AVI 由标准库生成，12 秒真实 PCM 音频和运动 RGB 视频，不依赖 `lavfi`、设备或网络。候选通过现有 `files` multipart 上传，检查物理文件加密、原流字节、HEAD、Range 206/416、认证拒绝、AAC/H264 全流解码与每个 HLS 片段。重复准备、重试与浏览器播放后，比较项目 API、附件列表及加密原件 SHA256。

浏览器加载候选实际页面及自托管 Video.js 10.2.0 模块，在 1440 与 390 CSS 像素宽度逐一播放音频和视频、暂停、跳到 6 秒并关闭预览，输出四张截图。浏览器所有外部网络请求都会被阻止并判失败。该证据只代表本机无头浏览器两种视口，不能称为原生 Windows 桌面、真实手机或外网访问验收。

```powershell
& 'C:/Users/33240/AppData/Local/Python/3.12/python.exe' tools/verify_media_release.py `
  --candidate '明确的公开版候选.exe' --candidate-sha256 '64位SHA256' `
  --baseline '明确的公开版基线.exe' --baseline-sha256 '64位SHA256' `
  --engine-directory '包含engine-manifest.json与ffmpeg.exe和ffprobe.exe的目录' `
  --evidence 'E:/系统/源码/05-清理与归档清单/项目系统交付记录/预览与媒体模块评估-2026-10-29/成品媒体验收/具体运行编号'
```

任何必填输入缺失均退出失败，不跳过成品检查。验证异常写入 `media-exe-acceptance.json` 并返回非零；临时许可、密钥、数据库及媒体派生文件不会写入证据。可用 `--browser-executable` 固定本机 Chromium，`--timeout` 指定单次准备最长秒数。

工具本身的失败保护测试：

```powershell
& 'C:/Users/33240/AppData/Local/Python/3.12/python.exe' -m unittest tests.test_media_release_verifier -v
```
