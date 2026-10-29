# v5.8.53 已发布成品补充验收

本清单只针对 `v5.8.53-public`，源码提交 `00a1f6c6b6d2282ea5ef37d51255ca092f93b52b`。运行前核对资产 SHA256；其他版本或兼容版结果不能替代公开版结果。验收脚本不修改产品，不重建已发布 EXE。

| 公开资产 | SHA256 |
| --- | --- |
| procurement-project-manager.exe | d1e7f4f0c9e343826ff57e48870033200e95e038cef801855404f0b8aa5dff97 |
| license-issuer.exe | 21a13ec1604a5e4d40d11124a2863c2ef0ce5629e1bf3c9612b694494c01ac0f |
| license-bound.exe | 51186a1dc7075ce2c5a338b5af45074b3db017756621b68c241e00e9707ade09 |

自动验收命令：

```text
python tools/verify_authorization_release.py --directory PUBLIC_ASSETS --manifest PUBLIC_MANIFEST.json --report issuer.json
python tools/verify_installation_release.py --candidate PUBLIC_V53.exe --sha256 d1e7f4f0c9e343826ff57e48870033200e95e038cef801855404f0b8aa5dff97 --license-fixtures SYNTHETIC_PUBLIC_LICENSE_DIR --baseline PUBLIC_V52.exe --baseline-sha256 abfc4748dbd9a5d7c598837f4c5ba61c049c3115933cc8c5d9ebd16006f6d946 --output INSTALLATION_EVIDENCE_DIR
python -m unittest tests.test_release_installation_acceptance
```

授权 CLI 保持原有 `--directory --manifest --report` 参数；manifest 接受原有 `assets` 字典和公开资产映射列表。报告包含实际路径、SHA256、进程退出码和耗时。两种工具分别以空密钥目录初始化，验证签名、公钥导出、原密钥复用、错误密码拒绝及旧许可保持；绑定版另验证错误磁盘拒绝。所有初始化私钥只在仓库外临时目录生成，不读取或上传发行私钥。

安装 fixture 必须是专为测试生成的公开版 `license.dat` 和 `license_public_key.pem`；可带 `.license_state.bin`。不复制真实数据或邮箱配置。初始登录移除管理员密码环境覆盖，强制启用许可校验；使用独立中文路径、数据库、端口和日志。

| 自动验收范围 | 完成条件 |
| --- | --- |
| 首次部署 | 启动前无数据库，admin/123456 登录，项目为空，许可有效 |
| 实际运行版本 | `/health` 和 `/api/system-info` 确认 v5.8.53 |
| 中文路径、关闭重启 | 独立中文目录运行，密码修改后重启可登录，测试进程退出后端口关闭 |
| 合成历史升级 | 实际启动公开 v5.8.52，创建跳过阶段、关闭项目和加密附件，再换入已核 hash 的公开 v5.8.53 |
| 升级数据保留 | 项目及阶段事实、关闭日期、附件保持，生成编辑令牌，再次重启仍保持 |
| 备份恢复 | 停止测试进程后完整数据目录 ZIP，含生成的加密密钥和附件，恢复到另一个隔离目录；逐文件 hash 一致后启动并验证事实和附件解密 |

这里的备份恢复验证是停机文件快照恢复，不等于已验证定时备份 ZIP 的生成或图形化恢复入口。恢复前保留数据库、附件、许可和数据加密密钥的整套关系；只复制数据库无法证明附件可恢复。备份输出路径在精确文件校验后调整为新隔离目录。

安装报告 `automated_passed_manual_pending` 只表示自动范围通过。以下项目必须人工填写日期、测试人、设备、显示缩放和证据，不能因自动测试成功改为 PASS。

| 人工项 | 当前状态 | 人工步骤与通过条件 |
| --- | --- | --- |
| 原生窗口启动 | pending | 在专用测试电脑打开 hash 一致的 EXE；窗口无报错、内容可读、登录正常 |
| 最小化、托盘与关闭重启 | pending | 验证最小化、还原、窗口关闭与托盘退出的实际行为，重新启动后无异常进程或数据丢失 |
| Windows 缩放和多显示器 | pending | 分别检查 100%、125%、150%、200% 缩放；窗口移动到不同缩放显示器后输入、弹窗、滚动和按钮可用 |
| 真实工作电脑升级 | pending | 由操作者备份并确认原许可、加密密钥、附件和数据后升级；只读复核历史数据和授权；本自动流程不操作在用电脑 |

不自动切换或重启用户程序。自动报告中的 `native_desktop_verified` 保持 `false`；人工记录应独立保存，注明具体覆盖范围。
