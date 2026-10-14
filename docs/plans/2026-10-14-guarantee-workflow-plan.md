# Guarantee Workflow Implementation Plan

> Use superpowers:subagent-driven-development for independently owned modules, inline integration, scoped task review and final branch review.

**Goal:** 按真实参与与缴纳记录管理结果公告、退还期限、日历和邮件，保护历史已完成业务。
**Architecture:** 独立扩展表保存版本政策、参与登记、保证金、规则和投递状态；已有阶段/报名/结果数据只读取。桌面启动注册新接口和校验钩子；扩展现有界面与日历、邮件管道。
**Tech Stack:** Python3.12、Flask/SQLAlchemy/SQLite、原生JS/CSS、node:test、unittest、Playwright。
**Spec:** docs/plans/2026-10-14-guarantee-workflow-design.md

## Global Constraints
- 当前基线d0fbc28，功能分支feat/guarantee-workflow；私有授权模块不变，业务测试隔离。
- 新发布v5.8.27；本地成品包含中文描述与版本，先本地后GitHub。
- 旧完成项目/公告保留；无效供应商已缴保证金不漏跟踪。

## Review Focus
- 同名跨包、联合体身份不能串包或重复退款。
- 首次升级不能自动完成/删除旧记录；已有结果不靠名单变化静默重写。
- 节假日跨年未知拒绝计算，补班纳入工作日。
- 无效投标、未参加、暂缓仍保留实际缴款义务与原期限。
- 重复保存/扫描、多会话修改、SMTP失败不能重复退款任务或静默丢信。

### Task 1: 权威节假日与期限计算
Files: src/backend_patches/holiday_calendar.py, docs/data/holidays/2026.json, tests/test_holiday_calendar.py.
- [ ] 先测2026放假/补班、跨年未知、工作日/自然日次日起数、输入与版本更新失败，运行失败证据。
- [ ] 实现day_info(date), calculate_deadline(start,days,kind,cutoff=''), validate_data(), update_data()，官方来源/version/hash可核对；不触及既存任务。
- [ ] 通过单测，自审并提交，独立review。

### Task 2: 参与、保证金扩展账本与接口
Files: src/backend_patches/tender_guarantee.py, tests/test_tender_guarantee.py.
- [ ] 先测名单身份、参加与有效分离、金额与退款、旧快照保护、revision冲突、后端公告过滤、异常原因、规则与起算、去重。
- [ ] 实现register(app,db,models)；GET/PUT /api/projects/<pid>/tender-guarantee返回revision/data/policy/summary。只扩展表，首次政策记录已完成key与项目；GET不改变业务状态。新项目自动政策，新规则登记需确认。
- [ ] 实现纯validate/eligible/derive_items与阶段、日历、提醒数据接口，可调用holiday_calendar。result POST/PUT后端筛选按policy，历史完成公告例外保留。
- [ ] 通过隔离HTTP/存储测试，自审提交，独立review。

### Task 3: 主题界面与联动集成
Files: source/frontend/18-tender-guarantee.js, 04-project-workflow.js, 05-views.js, 07-business.js, 06-admin.js, CSS mirrors; desktop_app_replacements.py, compile_module_patches.py, reminder_routing.py.
- [ ] 新增名单/缴款/规则表单测试及后端编译集成测试，先运行失败。
- [ ] 开标评审嵌入名单列表、保证金阶段摘要与规则入口；公告按后端policy筛选；日历节假日和事项；收件组增加事件字段和测试预览。
- [ ] 编译包注册新模块与端点，既有后台扫描接入保证金事件，依赖现有发送安全/重试路径。
- [ ] frontend build、针对测试+回归，头less浅深主题窄屏和真实HTTP确认。

### Task 4: 兼容成品、审查与本地/远端交付
- [ ] 所有相关单测、完整回归、独立评审修复；模拟SMTP验证规则/边界/去重/失败恢复。
- [ ] 构建兼容EXE与公开包，以临时数据验收新创建及旧项目升级；保护模块字节核验。
- [ ] 本地中文成品、快照、仓库bundle、校验/交接齐备，然后GitHub源码与中文标签附件发布，回填CI结果。
