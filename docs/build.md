# 构建与验证

## 环境

Windows、Python 3.12、Node.js（需支持 `node --test`）。构建依赖见 `requirements-public.txt`。应用的历史核心依赖已包含在运行时 EXE 中；安装这些依赖不会使本仓库变成完整核心源码。

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-public.txt
node tools/build_frontend.js --check
npm ci
```

修改前端时先执行 `node tools/build_frontend.js --write`，再执行 `--check`，并一同提交生成文件。

## 构建 Windows 应用

从本项目 Releases 获取公开运行时 EXE 和对应的 SHA-256；将运行时放在仓库之外。不要选择正在运行的生产应用，也不要覆盖构建输入。下面是 PowerShell 示例，路径与校验值需替换为实际下载的公开资产：

```powershell
$baselineExe = 'C:\public-runtime\procurement-project-manager.exe'
$baselineSha = (Get-FileHash -LiteralPath $baselineExe -Algorithm SHA256).Hash.ToLowerInvariant()
# 将 $baselineSha 与该 Release 公布的 SHA-256 比较，确认一致后继续。
.\.venv\Scripts\python.exe tools/build_public.py `
  --source-exe $baselineExe `
  --source-sha256 $baselineSha `
  --destination 'dist\procurement-project-manager.exe' `
  --report 'dist\public-build-report.json'
```

构建流程集成公开资源与扩展，并清理历史部署标识、原授权公钥和内置数据。输出仍依赖基线的编译核心。阅读构建报告并进行实际启动验证后，才将产物用于部署或发布。当前仓库无法提供 Linux/macOS 完整应用构建，亦无法提供完全脱离基线 EXE 的应用构建。

## 测试

```powershell
npm test
py -3.12 -m pip install -r requirements-public-test.txt
py -3.12 -m unittest discover -s tests -p 'test_*.py'
py -3.12 -m unittest discover -s tests -p 'public_authorization*.py'
```

测试涵盖公开扩展，也保留部分历史归档和打包集成测试。这些测试可能需要匹配的运行时、指定环境变量或 Windows 环境；应根据测试输出区分通过、跳过与缺失输入，不能将仅前端检查通过描述为完整应用验证通过。

每次发布还需验证新部署授权初始化、首次登录、项目与阶段操作、附件、备份恢复及默认数据库的空白状态；真实业务数据不用于公开测试。

加密数据库集成测试需要主机上的可选 SQLCipher 依赖；缺少时该案例明确跳过。提供打包程序输入进行设备准入集成测试时，还需对应的 Windows DPAPI 测试绑定。应用 EXE 自带运行依赖，与主机测试环境分开。


## 保留已有授权的本地升级

维护已有授权部署时，选择原部署的 V5 运行时作为输入，保留它的授权与数据密钥协议。构建器校验原授权模块、公钥、授权状态函数与数据密钥模块一致，然后输出新的升级成品；不写业务数据库、许可证或签发私钥。输入与输出使用不同路径。

```powershell
$env:PYTHON312 = 'C:\Python312\python.exe'
$originalRuntime = 'C:\licensed-runtime\original.exe'
$originalSha = (Get-FileHash -LiteralPath $originalRuntime -Algorithm SHA256).Hash.ToLowerInvariant()
py -3.12 tools/build_local_upgrade.py `
  --source-exe $originalRuntime `
  --source-sha256 $originalSha `
  --destination 'dist\licensed-upgrade.exe' `
  --report 'dist\licensed-upgrade-report.json'
```

该输出沿用原部署的信任配置，应保存在本地升级交付中。公开发布使用前述 `build_public.py` 及自建密钥配置。源码边界相同：仍需原编译运行时，不能从零构建完整核心后端。
