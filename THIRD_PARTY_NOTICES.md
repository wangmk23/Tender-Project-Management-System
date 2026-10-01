# 第三方软件与字体声明

仓库根目录的 MIT 许可仅适用于本项目原创内容。下列第三方代码与字体继续采用各自许可；不得以移除原部署品牌为由删除第三方版权、许可注释或作者归属。

## 静态资源

| 组件 | 本仓库位置或识别依据 | 许可及原文 |
| --- | --- | --- |
| SheetJS CE 0.18.5 | `static/libs/xlsx/xlsx.full.min.js`，脚本版本常量 | [Apache-2.0](docs/licenses/sheetjs.txt)；SheetJS |
| JSZip 3.10.1 | `static/libs/jszip.min.js`，文件头 | [MIT 或 GPL-3.0 双许可](docs/licenses/jszip.txt)，本项目采用 MIT；Stuart Knightley 等 |
| pako | JSZip 与 Luckysheet 内嵌依赖 | [MIT](docs/licenses/pako.txt)；Vitaly Puzrin、Andrei Tuputcyn |
| docx-preview | `static/libs/docx-preview/` | [Apache-2.0](docs/licenses/docx-preview.txt)；Volodymyr Baydalka |
| PDF.js | `static/libs/pdfjs/`，保留 Mozilla 版权头 | [Apache-2.0](docs/licenses/pdfjs.txt)；Mozilla Foundation |
| Luckysheet | `static/libs/luckysheet/` | [MIT](docs/licenses/luckysheet.txt)；Mengshukeji |
| jQuery / Sizzle | Luckysheet 插件 | [MIT](docs/licenses/jquery.txt)；jQuery/JS Foundation 及贡献者，保留代码内归属 |
| jQuery UI 1.12.1 | Luckysheet 插件脚本与样式 | [MIT](docs/licenses/jquery-ui.txt)；jQuery Foundation 及贡献者 |
| Lodash | 依赖资源的上游许可，保留 Underscore 归属 | [MIT](docs/licenses/lodash.txt)；OpenJS Foundation、Jeremy Ashkenas 等，保留代码内归属 |
| Numeral.js 2.0.6 | Luckysheet 内嵌代码 | [MIT](docs/licenses/numeral.txt)；Adam Draper |
| core-js | Luckysheet source map 中可识别的依赖 | [MIT](docs/licenses/core-js.txt)；Denis Pushkarev |
| Day.js | Luckysheet source map 中可识别的依赖 | [MIT](docs/licenses/dayjs.txt)；iamkun |
| Flatpickr | Luckysheet source map 中可识别的依赖 | [MIT](docs/licenses/flatpickr.txt)；许可文件列出的贡献者 |
| TypeScript runtime helpers | Luckysheet 内嵌微软许可头 | [许可原文](docs/licenses/tslib.txt)；Microsoft Corporation |
| Font Awesome 4.7.0 | Luckysheet `fonts/` 与插件样式 | 字体 SIL OFL-1.1，代码 MIT；[许可说明与字体条款](docs/licenses/font-awesome.txt)，Dave Gandy |
| Anton / Pacifico / Hanalei Fill | Luckysheet `assets/iconfont/` 内字体文件 | SIL OFL-1.1：[Anton](docs/licenses/font-anton.txt)、[Pacifico](docs/licenses/font-pacifico.txt)、[Hanalei Fill](docs/licenses/font-hanaleifill.txt) |
| Luckysheet iconfont | Luckysheet `assets/iconfont/iconfont.*` | 上游项目 [MIT](docs/licenses/luckysheet.txt)；[来源与逐文件校验记录](docs/licenses/luckysheet-iconfont-provenance.json) |

上表路径均相对于 `src/project_manager/`。没有精确版本证据的组件不推断版本；[上游许可来源](docs/licenses/SOURCES.md)列出下载来源。部分原文取自上游现有分支，保留原始版权年份；它们用于记录来源，不代表已完成归档二进制的逐版本比对。

## 可选资源与字体来源

可选 ChartMix 插件已从公开源码和运行时排除，Excel 预览明确禁用插件。Luckysheet 自定义 iconfont 二进制与官方仓库同路径资源相同，来源校验记录见上表；SVG/CSS 为同源资源的不同修订，保留上游 MIT 归属。上游图片继续属于其所在组件，不能重新标注为本项目原创。

## Windows 编译运行时

历史运行时包含 Python、PyInstaller、Flask、SQLAlchemy、cryptography、SQLCipher 等第三方组件，可能还包含其他传递依赖。已从构建基线提取的[许可原文、版本表与 cryptography SBOM](docs/licenses/runtime/README.md)保留在 `docs/licenses/runtime/`。该提取只覆盖归档携带的许可资产，不是完整软件物料清单。

SQLCipher 4.12.0 community 的[BSD 型许可](docs/licenses/runtime/sqlcipher-4.12.0-LICENSE.txt)及[官网许可说明](https://www.zetetic.net/sqlcipher/license/)单独保留；所链接 OpenSSL 3.6.0、其他运行组件使用的 OpenSSL 3.0.15 与 4.0.0 的许可原文也在运行时目录。构建工具使用的 PyInstaller、cryptography 与 pefile 的安装包亦保留各自许可。发布者应随实际 Release 提供依赖清单与相关许可文件，不能用本项目 MIT 替代运行时组件许可。

系统托盘组件 pystray 0.19.5 采用 LGPL-3.0，未修改。随附[完整对应源码](vendor-sources/pystray-0.19.5.tar.gz)、GPL/LGPL 原文与[运行库替换说明](docs/runtime-library-replacement.md)。用户可以修改该库并重新组合应用运行时，亦可为调试修改进行所需逆向工程；本项目未附加限制这些权利的许可条件。分发发布 ZIP 时需保留源码包和替换工具。
