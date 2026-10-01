# 替换 pystray 运行库

Windows 运行时包含未修改的 pystray 0.19.5，用于系统托盘功能。它采用 LGPL-3.0，本项目原创代码采用 MIT。随附的[完整官方源码包](../vendor-sources/pystray-0.19.5.tar.gz)、[SHA-256](../vendor-sources/SHA256SUMS)与[GPL](licenses/runtime/pystray-0.19.5.dist-info__COPYING)、[LGPL](licenses/runtime/pystray-0.19.5.dist-info__COPYING.LGPL)原文应与应用一并分发。

归档中的全部 13 个 pystray 模块已与官方 v0.19.5 源码逐模块比较；编译后的函数签名、代码与常量一致。该库未添加项目私有修改。

你可以修改 pystray，并用公开的 `tools/replace_runtime_library.py` 将自己的模块重新组合进应用运行时；允许为调试这些修改进行所需逆向工程。本项目不附加限制这些权利的许可条款。

## 替换步骤

1. 保存公开运行时 EXE 的副本，安装[构建环境](build.md)中的 Python 3.12 与构建依赖。
2. 解压官方源码包；包目录为 `lib/pystray`。在自己的副本中修改 `.py` 文件。
3. 运行下面命令，指定公开输入 EXE、修改后的 pystray 包目录与不同的输出 EXE 路径。
4. 工具重新编译并替换归档中的模块，保留其余运行时内容。运行输出应用并验证托盘菜单与退出行为。

替换要求保留原包接口并与运行时的 Python 版本相容。工具不应默默忽略新增且无法收录的模块；若修改需要新增包或依赖，需按其提示调整归档构建流程。任何签名或发布 SHA-256 都不能继续代表修改后的 EXE，应自行计算新校验值。该替换流程不需要原始私钥或业务数据。

```powershell
$runtime = 'C:\public-runtime\procurement-project-manager.exe'
$runtimeSha = (Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash.ToLowerInvariant()
py -3.12 tools/replace_runtime_library.py `
  --source-exe $runtime `
  --source-sha256 $runtimeSha `
  --library-source 'C:\modified-library\pystray-0.19.5\lib\pystray' `
  --destination 'C:\public-runtime\procurement-project-manager-modified.exe'
```

分发修改后的库时保留 GPL/LGPL 原文，明确说明修改内容，并提供对应库源码和重新组合所需材料。不要将本项目 MIT 版权声明覆盖到 pystray 源码上。
