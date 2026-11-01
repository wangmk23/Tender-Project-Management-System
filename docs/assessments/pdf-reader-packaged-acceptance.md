# PDF 阅读器成品验收工具

`tools/verify_pdf_reader_release.py` 只验收显式指定并通过 SHA256 固定的 Windows EXE。缺少 `--candidate`、`--candidate-sha256`、`--evidence` 时命令行退出 2；文件、哈希、浏览器或任一必验项失败时验收失败，不记跳过，也不自动改用源码服务。启动的是隔离临时目录中的候选进程，不连接现有业务实例。

```powershell
python tools/verify_pdf_reader_release.py `
  --candidate '<公开候选EXE绝对路径>' `
  --candidate-sha256 '<64位SHA256>' `
  --evidence '<本轮专用证据目录>'
```

可用 `--browser-executable` 固定浏览器路径；指定路径无效时直接失败。依赖项目既有 Python 验收环境与 Playwright，不新增 PDF、OCR 或渲染依赖。报告写入 `pdf-reader-exe-acceptance.json`，包含实际候选路径、哈希、每项结果、缺失必验项与失败堆栈。报告只有全部必验项通过才会 `passed: true`。

## 样本与真实数据路径

- 三页 PDF：标准库生成的有效 PDF 对象、xref、Helvetica 文字；每页一个 `ProjectNeedle`，原生三级条目书签树，第一页有到最后一页的原生内部链接。
- 269 页 PDF：同一生成算法，每页真实文字，验证最后页、全文件搜索和画布资源约束。允许 269 个页面占位节点；实际存活页面 canvas 与观察峰值须小于 20，页面占位不得超过 269，总 DOM 节点小于 18000。这是本组合成样本的明确预算，不是任意 PDF 的性能承诺。
- 扫描小样本：纯灰度 Image XObject，无文字层、无原生书签。验收明确展示无书签、不可搜索文字的提示；不生成虚假目录、不声称 OCR。
- 自动打印样本：三页 PDF 含原生 `/OpenAction << /S /Named /N /Print >>`。通过 PDF.js 实际解析确认 Print 动作存在，要求打开后 native print 计数仍为零、没有启动打印服务。单纯禁用 PDF 脚本不足以代替此验收。

样本通过候选真实 multipart API 上传。检查实际新增密文文件与明文不同、有加密开销；通过候选下载的字节及 SHA256 须与原样本相同。阅读、搜索、打印准备之后再验证项目、附件记录和密文原件没有改变。匿名访问每个样本的 view、download 都必须被拒绝。

隔离授权使用现有 `owned_client` 的自建公开测试身份。工具不接受真实业务数据库、部署许可、私钥、邮箱配置作为输入；临时生成的测试许可和密钥不写入证据。

## 浏览器检查

浏览器访问候选 EXE 实际提供的主界面，通过主界面附件入口打开 `#docPreviewOverlay` 内的同源 `#pdfReaderFrame`。检查 `/static/pdf-reader/index.html` 和官方 PDF.js `6.4.299` 的 core、viewer、worker 来自候选自身服务。

验证原生书签树层级和目标页、PDF 内部链接、输入页码直达最后页、上一页/下一页、可见当前页与页数、Ctrl+F、全文命中数、前后结果和文字高亮。扫描件单独验证能力边界。四个产品主题（default、blue、green、dark）分别在 1440 和 390 CSS 像素宽度截图；检查父弹窗、iframe 与内部工具栏没有横向溢出。切换附件、关闭预览、切换项目时必须移除旧 iframe；标注为注入的旧 reader 消息不能让已关闭预览复活。

浏览器拦截并记录所有外部 HTTP(S) 请求；任何外部请求或 JavaScript `pageerror` 都使验收失败。390 宽度只代表桌面无头浏览器的手机视口，不代表真实 Android 或 iOS。

## 打印准备的证据边界

`context.add_init_script` 在官方 viewer 导入前安装 native `window.print` 计数桩。官方模块捕获此桩，自己的完整打印函数仍执行 `renderPages()`；只有全部页渲染完毕，官方实现调用原生打印时才进入计数桩。

工具通过真实打印按钮触发此流程，在进入桩时采集 `#printContainer .printedPage img`。三页都必须完成图片加载且具有实际宽度，才记为内部打印准备通过。不会向物理打印机提交作业，报告始终保留 `physical_print_verified: false`。

## 工具自身验证

```powershell
python -m unittest tests.test_pdf_reader_release_verifier -v
```

失败关闭单测覆盖必需 CLI、非法哈希、哈希不匹配的失败证据、漏跑必验项、跨源/跨附件 URL、有效 xref 与原生 PDF 结构、纯扫描层边界、自动打印源动作、未完成的打印准备拒绝。源码 shell 上的独立 fixture/harness 自检须与实际 EXE 证据分别保存，不能替代成品验收。
