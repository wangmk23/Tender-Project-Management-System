# Windows 媒体引擎构建（v55 独立工作）

本构建只在 `public/media-engine-v55` 分支产出 Actions artifact，不创建 release，不修改 v5.8.54 标签、资产或业务源码。引擎作为独立进程使用，提供根目录 `ffmpeg.exe`、`ffprobe.exe`、`engine-manifest.json`，不依赖系统 PATH 或额外第三方 DLL。

FFmpeg 固定官方 n9.0.2 / `946fcce07b6dcd0331c8cc609192aeff5e1924f8`，官方 tar.xz SHA256 为 `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`。官方发布签名、公钥指纹及归档哈希均校验，并将归档全部 Git 跟踪源码与固定提交比较，排除 Git 元数据及生成 VERSION 文件。没有修改 FFmpeg 源码。

配置关闭 GPL、version3、nonfree、网络及依赖自动探测，静态构建 LGPL-2.1-or-later 子集。仅显式启用固定 dav1d 1.5.4（BSD-2-Clause，AV1 软解）和 zlib 1.3.2（Zlib，PNG 等压缩格式）；其版本、归档哈希及许可记录于 `tools/media_engine/sources.json`。不使用 libx264、GPL 聚合包或日构建。h264_mf 使用 Windows Media Foundation；Windows N/Server 是否具备系统组件和可用编码 MFT 必须实际验证。

Ubuntu 24.04 安装工作流列出的 MinGW、NASM、Meson 等工具后，执行：

```bash
bash tools/media_engine/build_windows.sh /absolute/new-build-dir /absolute/new-engine-dir
```

输出目录必须不存在，脚本不删除或覆盖旧构建。`--plan` 仅打印固定源码清单，可在 Git Bash 下查看。配置宏及 PE import 检查必须通过：h264_mf、AAC、PNG、HLS、libdav1d 均须存在；仅允许 file/pipe 协议；GPL/version3/nonfree/network/shared 均关闭；导入只允许 Windows 系统 DLL，拒绝 libwinpthread 等额外运行库。

artifact 同时携带三份对应完整源码归档、FFmpeg 官方签名/公钥、未修改说明、完整 configure 参数、构建脚本、FFmpeg 配置和编译日志、工具链包版本及许可。重新构建使用相同固定项目源码；宿主 Ubuntu 工具链实际版本完整记录，不宣称未经验证的跨时间逐字节重现。使用静态独立 CLI 的完整相应源码及重建材料随二进制一起分发；上层软件通过进程调用，不把 FFmpeg 静态库链接进专有程序。分发时保留 FFmpeg 名称、许可与对应源码可取得性，不把专有软件限制套用于这些组件。该说明不保证任何编码格式的专利许可。

官方依据：[FFmpeg 稳定下载及签名验证](https://ffmpeg.org/download.html)、[FFmpeg LGPL 及可选 GPL 边界](https://ffmpeg.org/legal.html)、[dav1d 1.5.4 源归档](https://downloads.videolan.org/pub/videolan/dav1d/1.5.4/)、[zlib 官方源及哈希](https://zlib.net/)。初始 FFmpeg 归档哈希还与 [MSYS2 上游源配方](https://github.com/msys2/MINGW-packages/blob/master/mingw-w64-ffmpeg/PKGBUILD) 核对；本构建没有使用该 GPL 二进制或配置。

交叉构建成功只证明编译和静态依赖边界。随后 Windows 作业运行版本、许可、codec/format 列表以及 PNG/AAC/h264_mf 合成冒烟，并保留失败证据。`full_format_matrix_verified` 始终 false，实际文件、浏览器播放和本机 Media Foundation 编码能力仍由后续本机格式矩阵验证。
