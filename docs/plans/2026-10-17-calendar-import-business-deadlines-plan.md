# 节假日导入与业务期限联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可离线导入年度放假调休安排、可复核的跨业务期限计算、日历和邮件联动。

**Architecture:** 保留现有年度日历接口和保证金算法；年度导入独立管理不可变修订与预览。独立期限引擎和扩展表承载项目规则及事项，原阶段只增加入口，不回填历史业务。

**Tech Stack:** Python3.12 / Flask / SQLAlchemy扩展SQL / stdlib ZIP+XML XLSX / 原生JS CSS / Node tests / Playwright。

**Spec:** `E:/系统/源码/03-开发规范与界面风格/需求设计/2026-10-17-节假日模板导入与业务期限联动设计.md`（源码镜像`docs/plans/2026-10-17-calendar-import-business-deadlines-design.md`）。

## Global Constraints

- 保留v5.8.33历史数据、原授权与密钥；禁止替换或重启E:/系统/项目系统运行实例。
- 全部功能在隔离工作树与临时数据验收；正式资料仍放E:/系统/源码编号目录。
- XLSX上传2MiB、ZIP128成员/总8MiB/单4MiB、年度2000–2100、366条/366日期；拒绝公式/宏/外链/DOCTYPE。
- 年度导入完整替换，预览30分钟有效、会话绑定、基准修订CAS；确认前无业务写入；恢复产生新修订。
- 四主题、统一日期控件、44px主要触控、分页50条；不增加新的桌面运行依赖。
- 规则必须区分制度、方法、事实事件、工作日/自然日、顺延政策、建议/确认；缺年度不猜。
- 用户已于2026-10-17确认书面设计并明确“执行”；计划是获准设计的拆解，不引入新的产品范围；按此授权持续实施。

## Review Focus

1. Excel/WPS正常重存产生日期序列、1904系统和样式，读写往返不丢日期；Task1覆盖。
2. 两个管理员跨年度同时提交，索引原子更新不能丢另一年度；Task1覆盖并发与失败注入。
3. 旧业务入口改变日期、删除源事件或改采购包时，确认期限保留且标记需复核；Task3覆盖。
4. 邮件同时订阅阶段/期限、待复核或跨休假，不能错改期限、漏发或重复；Task4覆盖模拟队列。
5. 成品导入新模块、静态模板/缓存、年度持久化与重启不可仅源码通过；Task6覆盖真实EXE。

## 固定接口契约

年度GET返回原字段及`local_revision`、`origin`、`confirmed`。模板/导出返回XLSX。预览POST multipart字段`file,year,base_revision`；响应`{token,status,year,diff,summary,errors,impacts,base_revision}`；读取GET预览支持`page`。确认POST`{token,confirm_complete:true}`返回`{changed,message,calendar}`。历史GET返回`{year,items:[{revision,created_at,actor,operation,summary}]}`；恢复预览POST`{year,revision,base_revision}`沿用token确认。偏好仍用原接口。

项目配置GET/PUT返回`{revision,enabled,regime,custom_rules}`；PUT要求`revision`。规则GET返回`{rules:[{id,name,regimes,methods,kind,days,day_kind,basis,source_url,...}]}`。事项GET返回`{items,settings,sources,revision}`。预览POST`{rule_id,stage_key,lot_id,source_type,source_id,start_at,end_at,title,custom_rule,remind_days,cutoff}`返回`{token,calculation,item}`；确认POST`{token}`返回`{item,message}`。reviewPOST`{revision,action:accept|keep|pending,reason}`；statusPOST`{revision,status:completed|cancelled,reason}`。item包含`id,title,stage_key,lot_id,source_type,source_id,start_at,confirmed_deadline,proposed_deadline,state,needs_review,revision,rule,calculation`。

新增模块均用双import策略支持源码及PyInstaller顶层导入。新增服务导出`register(app,db,models)`；models沿用`Project,User,DATA_DIR,load_app_settings,save_app_settings`。业务期限导出`calendar_events(db,Project,year,month,cache_dir)`、`impact_items(db,Project,year,snapshot,cache_dir)`和`reminder_events(db,Project,now,cache_dir)`供根集成调用。年度服务从`app.extensions['calendar_impact_provider'](year,snapshot)`取得跨业务影响；不存在回调时不伪称影响为零。

### Task 1: 年度模板、校验、不可变修订与接口

**Files:** Create `src/backend_patches/holiday_import.py`, `tests/test_holiday_import.py`; Modify `holiday_calendar.py`, `calendar_service.py`, `desktop_app_replacements.py`的联网调度片段。
**Interfaces:** Produces `register`, `get_active(year,cache_dir)`, `revision_of(snapshot)`；hc.get_calendar保持原签名，识别导入来源，原保证金调用不变。

- [ ] 先写模板/导出往返、冲突/越界/公式/压缩/1904日期、过期/会话/并发、同值导入/恢复、原子失败、禁用联网测试。
- [ ] 运行`py -3.12 -m unittest discover -s tests -p test_holiday_import.py -v`，确认缺模块/功能失败。
- [ ] 实现受限XLSX解析生成、年度预览及CAS持久化和路由；写盘异常不切换索引。
- [ ] 运行新增测试及`test_holiday_calendar.py`,`test_calendar_service.py`，修复回归；记录RED/GREEN并提交。

### Task 2: 规则目录与纯计算

**Files:** Create `src/backend_patches/deadline_rules.py`, `tests/test_deadline_rules.py`。
**Interfaces:** `catalog(regime,method)->list[dict]`, `calculate(rule,start_at,*,end_at='',cache_dir=None)->dict`；含`deadline,raw_deadline,dependencies,steps,warnings,requires_review,valid`。

- [ ] 写5工作日/补班、1工作日、自然3日/不跳假、15日前间隔校验、时分、跨年缺数据、末日需核对、不同制度、无实际时间测试。
- [ ] 运行`py -3.12 -m unittest discover -s tests -p test_deadline_rules.py -v`确认失败。
- [ ] 实现受控卡片与白名单自定义参数、服务端计算和来源信息；无法核定不返回已确认法律结论。
- [ ] 新测试通过，记录RED/GREEN并提交。

### Task 3: 项目期限服务、审计与历史保护

**Files:** Create `src/backend_patches/business_deadlines.py`, `tests/test_business_deadlines.py`。
**Interfaces:** Consumes Task2.calculate及hc.get_calendar；Produces固定契约中所有项目期限接口和calendar/impact/reminder函数。

- [ ] 写权限/CSRF、默认未启用、旧项目不回填、不同记录/采购包、preview不写、确认CAS、源变更/删除、已确认值冻结、复核accept/keep、办结/取消和审计测试。
- [ ] 运行`py -3.12 -m unittest discover -s tests -p test_business_deadlines.py -v`确认失败。
- [ ] 实现加密数据库扩展表、事实源解析、预览凭据、事务确认、变更复核；不改写原核心模型。
- [ ] 运行新增服务/规则/原保证金测试，记录RED/GREEN并提交。

### Task 4: 主题界面、日历、订阅与运行集成

**Files:** Create `source/frontend/21-business-deadlines.js`, `src/project_manager/static/css/business-deadlines.css`, `tests/test_business_deadlines_ui.js`; Modify `19-holiday-calendar.js`,`04-project-workflow.js`,`06-admin.js`,`manifest.json`,模板/生成脚本、`reminder_routing.py`,`guarantee_delivery.py`,`desktop_app_replacements.py`,`calendar_service.py`。
**Interfaces:** Consumes固定HTTP契约；UI导出`showBusinessDeadlines(pid,stageKey='',itemId=null)`,`showDeadlineProjectSettings(pid)`与原`showHolidayCalendarSettings`。

- [ ] UI测试先覆盖文件预览/取消/错误保留/重复提交/历史恢复、无规则、记录直达、复核、四主题及可访问名称。
- [ ] 红灯后实现主题侧栏与日期控件；分组字段、原有业务入口和日历事件接入。
- [ ] 写邮件分类默认未订阅、同事实去重、旧期限继续提醒、完成取消待发、模拟失败重试测试；红灯后接入现有队列。
- [ ] 根集成保留原保证金事件与偏好；影响回调合并保证金和新期限，不能吞错变成零。
- [ ] 运行新增前端/邮件测试与`npm run build`,`npm run check`,`npm test`，独立审查并修正。

### Task 5: 构建、全量回归及跨模块审查

**Files:** Modify `tools/compile_module_patches.py`新增模块/marker、构建版本资源；Create `tools/verify_business_deadlines_release.py`；更新使用说明和版本清单。

- [ ] 补打包模块存在性/导入与缓存版本回归；红灯后加入构建输入。
- [ ] 全前端、Python回归与新接口集成通过；按四主题、桌面/手机无头检查。
- [ ] fresh独立审查全变更，安全及业务问题优先修复并建立复现回归，保留验证范围。

### Task 6: 成品验收与本地交付

**Files:** 现有编号目录中的新版本中文成品、交付记录、源码快照、bundle、入口JSON。

- [ ] 只读基线EXE及哈希，保留licensing/data_security/公钥；候选兼容与公开版分别构建。
- [ ] 临时目录运行真实候选，下载/导入/确认/重启持久化、公告/质疑/保证金/日历/模拟邮件、历史副本升级、无实际联网检查。
- [ ] 归档校验、开发/交接、当前版本及版本索引；原测试运行实例不重启。
- [ ] 本地齐备后，按现有授权同步GitHub公开源码和发布资产，标题仅版本号、中文附件标签；核实远端及CI后回填。
