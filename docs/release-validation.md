# v5.8.53 公开成品验收

产品固定为提交 `00a1f6c6b6d2282ea5ef37d51255ca092f93b52b` 和标签 `v5.8.53-public`。新增验证代码使用独立提交；不移动标签、不重建或覆盖已发布的三份 EXE。源码测试成功、文件哈希一致与成品行为验收是三个分别记录的事实。

`tools/release_validation_manifest.json` 锁定三个 v5.8.53 公开 EXE、v5.8.40 公开构建运行时和 v5.8.52 公开升级基线。SHA 来自仓库既有 `docs/releases/*.json`，与本地公开资产映射、构建输入核对。CI 只下载清单中的公开资产；没有兼容版、私钥、真实授权 fixture 或业务数据输入。

## Windows 自动化入口

`.github/workflows/release-validation-windows.yml` 使用 `windows-2025`、Python 3.12、Node 22；推送到独立 `public/validation-v5.8.53` 分支即触发，也支持手动触发。验证提交默认使用本次 `github.sha`，可显式提供完整 40 位 `verification_commit`。公开资产 URL 默认取 manifest；可选 `build_runtime_url` 只能指定本仓库公开 release URL，SHA 仍固定不可覆盖。工作流分别 checkout 产品固定提交和新验证提交，下载缺失、不可达或 SHA 不符立即失败，始终保留报告。只上传列举的报告与截图；不上传 EXE、数据库、备份、私钥、PEM 或 license fixture。

命令中所有路径应为绝对路径；`--output` 必须是本次新目录：

```powershell
python verification/tools/release_validation.py --product-root product --inputs-dir public-inputs --output evidence/preflight --download --preflight-only
python verification/tools/release_validation.py --product-root product --inputs-dir public-inputs --output evidence/acceptance
```

也可先把公开 EXE 复制到输入目录，按 manifest 的 `filename` 命名，省略 `--download`。缺一份、SHA 错误、非清单文件、非 Windows/Python 3.12、产品 HEAD/tag 错误或 tracked 文件已改，均失败且写 `release-validation.json`。预检成功仅为 `preflight_passed`，不代表 suite 已运行。

`tools/release_validation_suites.json` 列出必需 suite：`unittest`、`sqlcipher`、`public-runtime`、`browser`、`license-states`、`issuers`、`installation`。可配置命令，但不能缺少任何必需 suite。每个 suite 独立记录命令、工作目录、耗时、退出码、JSON 报告、stdout/stderr 和跳过项；一个失败后继续收集其他 suite。报告必须非空且明确通过；exit 非零、JSON 自报通过却存在失败 check、mandatory skip、unknown skip、空检查、pending、未完成、报告数量不符、observe/单项诊断模式均不能通过。optional skip 也逐项核对允许的精确 test id 和原因，不能仅凭自称 optional 放行。运行结束再次校验所有冻结输入未变。

构建溯源保留原发布构建报告的安全字段、原报告 SHA、已发布 EXE SHA、公开资产清单、原 24 项结构化 skip baseline。总报告记录这些文件的 SHA，artifact 明确包含它们。没有重新构建比对证据时，不声称新构建与旧发布逐字节相同。

安装适配器为该 suite 即时生成公开测试身份。原始 `installation.json` 完整保留原生窗口、显示缩放、实际在用电脑的人工待验项；适配器仅核对其自动化 checks，绝不把人工项算作通过。总报告始终 `complete_release_acceptance=false`、`native_desktop_verified=false`，列出 `manual_pending`。全部自动化 suite 通过时才设置 `automated_acceptance_passed=true` / `automated_passed_manual_pending`，工作流名也明示仅自动化。工作流成功不能用于声称完整成品验收通过。

## 原 1055 项中的跳过审计

2026-10-29 使用 Python 3.12 原生依赖，清除错误的 3.14 `PYTHONPATH` 后复现 `python -m unittest discover -s tests -p 'test_*.py' -v`：1055 tests / 90.747s / OK (skipped=24)。原始日志和结构化逐项清单保存在外层 05 的本次 `ci` 证据目录，不提交机器路径、日志或私有输入。首次错误依赖环境的失败日志也保留，未作为产品失败。

24 项为 23 required + 1 optional。唯一实际 optional 是当前宿主无创建符号链接权限；此项只验证构建输入的符号链接拒绝行为。额外精确列出的 optional 宿主 SQLCipher 缺包策略不适用于冻结成品：成品 SQLCipher 独立 suite 始终 required。其他未识别跳过默认 required。

required 模式在执行 discover 前配置 `PM_SOURCE_EXE`/`PM_SOURCE_EXE_SHA256`、`PYTHON312`、`PM_TEST_CANDIDATE_EXE`/`PM_TEST_CANDIDATE_SHA256`，从哈希锁定 EXE 提取实际 SQLCipher 连接器，使用 OS 临时目录中的新密钥签发公开测试许可。不会读取旧兼容授权。历史 PackagedClient 原先只复制 license，审计适配器同时复制新生成公钥到独立 data root；产品 checkout 与产品文件均不改。必须让原测试实际执行，不能用另一个 suite 的通过注销 required skip。

discover 使用独立 verification checkout 中的最新测试，`--test-harness-root` 默认是审计脚本所在仓库。审计逐文件核对 `source`、`src`、`authorization`、固定打包工具和依赖声明等于纯 00a product checkout，业务源码有变立即失败。报告分别记录产品提交、测试仓库提交、测试目录逐文件 SHA、聚合 SHA、未提交改动和业务字节一致性。原 24 项与本轮结果逐项映射；类 setUpClass 被跳过的原事件展开为本轮实际执行的类测试，不能漏项。

启用冻结输入后，旧测试的过时前提已校正：公开包本来不内嵌数据库、公钥和许可，所以验证空布局也被候选保留；允许替换的 Excel 库核对锁定的新库 SHA，其他库仍逐字节保护；保存采购方式模板先读取当前 `catalog_revision`；已禁用的批量改历史流程操作验证返回 409 `BULK_FLOW_DISABLED` 且历史项目事实不变。这些都是验收工具调整，未修改产品行为。

```powershell
python verification/tools/audit_release_skips.py --product-root product --mode required --prepare-public-fixture --packaged-sqlcipher --output evidence/unittest.json
```

观察旧日志可用 `--from-log LOG --mode observe --output REPORT`；观察模式记录 `complete_release_acceptance=false`，不能作为发布门槛。结构化报告保存每个 test id、原始跳过原因、依赖、分类和弥补路径。setUpClass 的跳过按 unittest 原始事件保留，不伪装成一次成功测试。

## 逐项清单

下表的 required 项均由 `unittest` required 模式执行原测试补齐；如果任何项仍跳过或测试失败，整个自动化门槛失败。`build` 表示哈希锁定公开构建运行时及 Python 3.12；`packaged` 表示哈希锁定公开系统 EXE、新临时签名许可及公钥；`host` 表示宿主符号链接权限。原始英文原因与 JSON 保持一致。

| Test id | 原因 | 分类 | 依赖 / 补齐 |
| --- | --- | --- | --- |
| `test_build_input.BuildInputTests.test_symlink_input_is_rejected` | symlink creation is not permitted | optional | host / 环境限定 |
| `setUpClass (test_business_input_validation.FrozenBusinessInputValidationTests)` | isolated frozen baseline is unavailable | required | build / unittest |
| `test_candidate_integrity.CandidateIntegrityTests.test_candidate_changes_only_approved_resources_and_verifies_dependency_free_export` | candidate integration requires an explicit hash-pinned source | required | build / unittest |
| `test_candidate_integrity.CandidateIntegrityTests.test_failed_build_preserves_the_previous_verified_candidate_pair` | transactional candidate build requires an explicit hash-pinned source | required | build / unittest |
| `test_candidate_integrity.CandidateIntegrityTests.test_icon_only_candidate_changes_no_other_archive_entries` | icon-only candidate test requires an explicit hash-pinned source | required | build / unittest |
| `test_candidate_integrity.CandidateIntegrityTests.test_windows_icon_copy_is_idempotent_and_preserves_archive` | Windows icon resource test requires an explicit hash-pinned source | required | build / unittest |
| `test_candidate_integrity.CandidateIntegrityTests.test_windows_icon_verification_rejects_a_different_ico` | Windows icon verification requires an explicit hash-pinned source | required | build / unittest |
| `test_device_admission_packaged_e2e.PackagedDeviceAdmissionTests.test_packaged_migration_preserves_old_browser_and_revocation` | packaged device admission test requires an explicit hash-pinned candidate | required | packaged / unittest |
| `test_device_admission_packaged_e2e.PackagedDeviceAdmissionTests.test_packaged_request_approval_restart_and_independent_data` | packaged device admission test requires an explicit hash-pinned candidate | required | packaged / unittest |
| `test_full_backup_regressions.FrozenBackupTests.test_encrypted_archive_database_and_attachment_restore_round_trip` | requires explicit hash-pinned source runtime | required | build / unittest |
| `test_full_backup_regressions.FrozenBackupTests.test_permanent_resource_lock_preserves_previous_candidate_pair` | requires explicit hash-pinned source runtime | required | build / unittest |
| `test_full_backup_regressions.FrozenBackupTests.test_same_clock_preserves_distinct_backups_and_retention` | requires explicit hash-pinned source runtime | required | build / unittest |
| `test_patch_carchive.PatchCArchiveTests.test_rejects_unknown_archive_entry_without_writing_output` | CArchive integration requires an explicit hash-pinned source | required | build / unittest |
| `test_patch_carchive.PatchCArchiveTests.test_replaces_only_requested_entries_and_preserves_source` | CArchive integration requires an explicit hash-pinned source | required | build / unittest |
| `test_stage_template_packaged_e2e.PackagedStageTemplateTests.test_copied_exe_uses_independent_local_settings` | packaged tests require an explicit hash-pinned candidate | required | packaged / unittest |
| `test_stage_template_packaged_e2e.PackagedStageTemplateTests.test_packaged_candidate_applies_every_method_template` | packaged tests require an explicit hash-pinned candidate | required | packaged / unittest |
| `test_stage_template_packaged_e2e.PackagedStageTemplateTests.test_packaged_candidate_reads_current_daily_stage_runtime_status` | packaged tests require an explicit hash-pinned candidate | required | packaged / unittest |
| `test_system_performance.SystemPerformanceContractTests.test_isolated_candidate_uses_packaged_sqlcipher_and_preserves_fingerprint` | candidate SQLCipher smoke requires the runner's pinned source | required | build / unittest |
| `test_system_performance.SystemPerformanceContractTests.test_runner_restores_set_and_unset_environment_after_injected_failure` | runner environment restoration requires the pinned source | required | build / unittest |
| `test_system_performance.SystemPerformanceContractTests.test_runner_restores_state_and_preserves_body_when_after_hash_fails` | runner finally failure injection requires the pinned source | required | build / unittest |
| `test_system_performance.SystemPerformanceContractTests.test_runner_restores_state_and_preserves_body_when_cleanup_fails` | runner finally failure injection requires the pinned source | required | build / unittest |
| `test_system_performance.SystemPerformanceContractTests.test_runner_rethrows_single_cleanup_failure_record_unchanged` | runner finally failure injection requires the pinned source | required | build / unittest |
| `test_system_performance.SystemPerformanceContractTests.test_runner_rethrows_single_hash_failure_compatibly` | runner finally failure injection requires the pinned source | required | build / unittest |
| `test_system_performance.SystemPerformanceContractTests.test_runner_rethrows_single_restore_failure_record_unchanged` | runner finally failure injection requires the pinned source | required | build / unittest |
