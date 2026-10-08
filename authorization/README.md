# 授权工具

两个入口：`license_issuer.py` 自由运用版（可远程签发）；`license_bound.py` 绑定磁盘版（仅为当前电脑签发）。本公开版本使用自行生成的 Ed25519 密钥，产品标识为 `procurement-project-manager`，不包含预置签发密钥或预设授权磁盘。

首次双击运行后，进入“密钥管理”，选择系统实际数据目录，点击「初始化密钥」，设置至少 10 位的私钥密码。绑定版必须先放在希望绑定的 Windows 磁盘上，初始化时明确确认绑定。公钥 `license_public_key.pem` 导出到所选系统目录；签发的 `license.dat` 也写入该目录。系统以这份公钥验签。

私钥（加密 PKCS8）、公钥备份和授权记录默认保存在 `%LOCALAPPDATA%\ProcurementProjectManager\issuer`。可用环境变量 `PROCUREMENT_ISSUER_HOME` 指定便携密钥目录，必须位于源码和 Git 仓库之外。两个工具可共享相同密钥目录：先初始化自由版，再在所选磁盘运行绑定版初始化，输入原私钥密码；绑定版会复用完整密钥对，仅创建新的磁盘配置。现有或不完整密钥和磁盘配置不会被初始化覆盖。

绑定版的 `issuer-config.json` 位于工具/EXE 所在目录，结构如下；`volume_serial` 是所选磁盘的实际 8 位十六进制卷序列号，初始化会生成它。配置缺失时只能完成初始化，不能签发；磁盘未知或不匹配时拒绝运行和签发。此限制是公开源码中的本地检查，不是防止用户修改源码的安全边界。

```json
{"version": 1, "product": "procurement-project-manager", "volume_serial": "<当前磁盘序列号>"}
```

CLI（在源码项目根目录）：

```powershell
$env:PROCUREMENT_ISSUER_HOME = 'D:\PrivateIssuer\free'
python authorization/license_issuer.py --init --target 'D:\ProjectManager'
python authorization/license_issuer.py --sign --target 'D:\ProjectManager' --org '示例单位' --days 365
python authorization/license_issuer.py --fingerprint
python authorization/license_bound.py --self-test
```

密码默认交互输入；自动化可使用 `PROCUREMENT_ISSUER_PASSWORD` 环境变量。签发先验签再写出，目标已有不同公钥时拒绝覆盖。向使用方交付系统、公钥和许可证；保留私钥、密码及签发记录。

依赖：Python 3.12、`requirements-public.txt` 中的构建依赖；Windows GUI 使用 Python 自带的 Tkinter。构建脚本统一加入应用图标并清理编译路径：

```powershell
py -3.12 -m pip install -r requirements-public.txt
py -3.12 tools/build_authorization.py --output dist
py -3.12 -m unittest discover -s tests -p 'public_authorization*.py' -v
```

首次使用的完整步骤在 ZIP 根目录“使用说明.txt”。密码输入、确认和状态提示使用应用内深色弹窗；私钥密码由使用者自行设置，没有默认值，与系统登录密码不同。
