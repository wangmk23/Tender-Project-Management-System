# 采购方式、数量规则与流程管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现按五类制度维护的采购方式目录、可解释的供应商数量检查和独立流程模板，历史项目与已完成资料保持原状。

**Architecture:** SQLite 扩展表保存目录、模板、项目/采购包快照和人工确认记录，使用现有数据库连接和事务，不另外打开未加密数据库。将目录存储、HTTP 接口、数量检查、项目流程调整分开；已有 API 与冻结运行时通过受控补丁接入，不用响应后补写模拟原子事务。

**Tech Stack:** Python 3.12、Flask、现有 SQLAlchemy/SQLite、原生 JavaScript/CSS、unittest、node:test/jsdom、Playwright、现有 PyInstaller 成品补丁工具；不增加产品运行时依赖。

**Spec:** `docs/superpowers/specs/2026-10-18-procurement-method-management-design.md`（afcd653，用户已确认）。

## Global Constraints

- 配置保存使用事务与版本冲突检查；多人同时保存过期版本返回冲突并保留本地未保存输入，提示重新加载。
- 数量规则：`fixed` 时为1至99的整数；`unfixed` 时数量为 null，不用0伪装无要求。
- 新项目采用创建时的配置快照，修改全局配置不改写已有项目；历史已完成结果不变。
- 旧配置没有制度信息时标为待确认，不根据“公开招标”等名称猜测。管理员确认制度后才用于新建项目；旧项目继续打开、编辑资料和推进。
- 固定数量且不足：警告并提供“继续办理，填写说明”或“人工标记流标/终止”；不自动改变业务结果。
- 保留四主题、字体、业务密度和自定义彩色 SVG。数字手动输入，不加步进箭头。
- 名称、备注、例外说明和模板文字按文本处理及转义；Excel 导出继续执行公式注入防护。
- 测试仅用隔离数据库，不自动切换运行电脑、不清空测试目录现有资料；先本地中文成品及记录，再公开发布。
- 原实际电脑报名到时自动完成逾期个案继续暂缓；历史核心仍为编译运行时。

## Review Focus

- 新建项目与删除方式并发：必须有且仅有一项成功形成有效状态，不得留下失效引用（Task 1/2）。
- 不同制度存在同名方式、旧表头没有制度：必须拒绝含糊匹配，不得取第一项（Task 2/6）。
- 停用的历史方式：旧项目保存其他资料和查看旧统计必须成功，但不能作为新项目候选（Task 2/5）。
- 人工继续办理后修改名单或规则：旧确认必须失效；批量和后台自动完成不能绕过（Task 3）。
- 已改名的内置竞价方式、超长或含 HTML 的自定义名称：业务模块不丢失，显示不执行 HTML，手机不溢出（Task 2/5/6）。

## 接口与数据约定

- 五个制度代码：`government_procurement`、`mandatory_construction_bidding`、`enterprise`、`collective`、`other`。迁移未分类为 null，页面显示“制度待确认”。不能将其视为 `other`。
- 方式结构：`{id, name, regime, notes, enabled, position, revision, builtin_kind, quantity_rule, exceptions, template_mode, stages, reference_count}`。`quantity_rule={mode,minimum}`；新方式默认 `unfixed/null`，数量由管理员选择；`template_mode` 为 `common` 或 `independent`。
- 例外结构：`{id,title,description,enabled,quantity_rule}`；例外标识由服务端生成。选择例外时必须保存该项目适用说明。
- `GET /api/procurement-methods` 返回 `{revision,common_stages,methods}`，含停用与待确认条目。项目用户只读，修改仅管理员；所有写操作沿用现有 CSRF 与项目访问控制。
- `POST /api/procurement-methods`、`PATCH/DELETE /api/procurement-methods/<id>`；创建/重排提交目录版本，修改/删除提交条目版本。`POST /api/procurement-methods/reorder` 提交完整标识序列及目录版本。`PUT /api/procurement-common-flow` 提交目录版本和阶段数组。
- 无效输入400；未登录/未授权沿用既有401/403；引用或过期版本409。错误正文包含稳定 `code`、可读 `error`，必要时带 `reference_count` 或 `blocked`。
- 创建或改选方式的业务请求使用 `procurement_method_id`；响应增加 `procurement` 快照对象，包含 `method_id,name_snapshot,regime,method_revision,quantity_rule,exceptions,builtin_kind,workflow_revision,current_name,current_enabled`，保留旧 `method` 显示快照字段。
- 项目流程接口：`POST /api/projects/<pid>/workflow/preview` 与 `/workflow/commit`；预览提交阶段数组，返回 `{base_fingerprint,diff,blocked}`，确认提交同一数组及指纹，服务端事务内重新验证。
- 人工确认接口：`POST /api/projects/<pid>/supplier-quantity/confirm`，提交 `{stage_key,lot_id,fingerprint,exception_id,reason}`；选择例外也通过此路径校验并记录。
- 不固定数量输出 `required_count:null,missing_count:null`，不得使用 `Number(null)` 参与不足判断。待核对名单输出 `pending`，不得假装实际数量为0。

---

### Task 1：持久化目录、迁移与引用保护

**Files:** 新建 `src/backend_patches/procurement_catalog.py`、`tests/test_procurement_catalog.py`；复用 `stage_templates.py` 的阶段规范化函数。

**Interfaces:** `ensure_schema(database)->None`；`migrate_legacy(database,settings:dict,stage_definitions:list)->dict`；`load_catalog(database)->dict`；`save_method(database,payload:dict,expected_revision:int,actor:str,method_id:str|None=None)->dict`；`reorder_methods(database,ids:list[str],expected_revision:int,actor:str)->dict`；`delete_method(database,method_id:str,expected_revision:int,actor:str)->None`；`save_common_flow(database,stages:list,expected_revision:int,actor:str)->dict`。服务函数使用调用方事务，不自行 commit；错误使用 `CatalogError(code,status,details)`。

- [ ] **Step 1 — 写失败测试：** 在隔离 SQLAlchemy SQLite 环境创建最小原业务表，覆盖旧配置导入、重复迁移、保存后换连接读取、全局/条目版本冲突、同制度重名与跨制度同名、固定数量边界、不固定数量、完整重排、引用阻止删除、失败回滚。`test_migrate_keeps_original_business_rows` 比较迁移前后原项目、阶段、名单和结果行完全一致；迁移不得清空损坏旧设置。
- [ ] **Step 2 — 验证红灯：** `py -3.12 -m unittest tests.test_procurement_catalog -v`，预期新模块/接口缺失失败，不能把夹具环境错误当红灯。
- [ ] **Step 3 — 实现：** 扩展表 `procurement_catalog_state`、`procurement_methods`、`project_procurement_snapshots`、`lot_procurement_snapshots`、`procurement_config_audit`。稳定 UUID、规范化 JSON、参数化 SQL、唯一性/外键/版本约束；旧方式携带原内置类型，通用模板来自原阶段顺序而非第一种方式。SQLite 写事务串行化删除和创建引用。
- [ ] **Step 4 — 验证绿灯：** 运行同一命令，全部通过。`test_create_reference_races_delete` 用两个真实数据库连接证明竞争后只有有效引用或创建失败；`test_backup_restore_roundtrip` 使用现有备份/恢复路径核对扩展表。
- [ ] **Step 5 — 提交：** `git add src/backend_patches/procurement_catalog.py tests/test_procurement_catalog.py`；`git commit -m "feat: persist procurement methods with safe legacy migration"`。

### Task 2：目录 API、项目创建/改选与兼容接入

**Files:** 新建 `src/backend_patches/procurement_api.py`、`tests/test_procurement_method_api.py`；修改 `app_replacements.py`、`desktop_app_replacements.py`、`business_input_validation.py`、`stage_templates.py`、`tools/compile_module_patches.py`；扩展现有创建和设置 API 测试。

**Interfaces:** 消费 Task 1。`procurement_api.register(app,database,models:dict)->None`；`resolve_method(database,method_id:str|None,name:str|None,regime:str|None,existing_project=None)->dict`；`bind_project(database,project,method:dict)->dict`；`enrich_project(database,project,payload:dict)->dict`；`is_online_bidding(project,payload:dict|None=None)->bool`，后四项在 `procurement_catalog.py`。已有项目改选时保留阶段，更新绑定和规则快照并审计。

- [ ] **Step 1 — 写失败测试：** Flask 测试端覆盖管理权限、CSRF、修改/删除409、新建自动匹配模板与全部配置快照、无独立模板时通用回退、改名不改旧 `method`、停用方式旧项目普通编辑成功、新建失败；只提供旧名称时唯一匹配成功，同名跨制度返回400。`test_renamed_builtin_bidding_keeps_modules` 核对内置语义与模块而非中文名称。
- [ ] **Step 2 — 验证红灯：** `py -3.12 -m unittest tests.test_procurement_method_api tests.test_stage_template_create_api tests.test_stage_order_api -v`，新场景应因未接入目录失败。
- [ ] **Step 3 — 实现：** 启动时迁移并注册接口；在项目创建事务内解析方式、创建引用和阶段快照。替换 `api_update_project` 时先锁定/验证项目、保留既有字段校验和授权，再同事务改选/保存；将其加入受控函数补丁目标。读取设置提供派生兼容投影，旧设置写入仅明确唯一映射时适配；拒绝旧批量同步和混合目录/普通设置写入，不留 JSON 第二权威源。注册新受控模块签名。
- [ ] **Step 4 — 验证绿灯：** 同一命令全部通过，另跑 `tests.test_desktop_app_replacements`、`tests.test_business_input_validation`、`tests.test_stage_template_runtime`。增加创建/模板并发测试，确认快照只能完整采用一个版本；接口错误不得留下半个项目或引用。
- [ ] **Step 5 — 提交：** 仅暂存本任务文件；`git commit -m "feat: connect procurement catalog to project lifecycle"`。

### Task 3：按阶段检查数量与人工确认，去除自动流标

**Files:** 新建 `src/backend_patches/supplier_quantity.py`、`tests/test_supplier_quantity.py`、`tests/test_supplier_quantity_api.py`；修改 `lot_supplier_risk.py`、`app_replacements.py`、`procurement_api.py`、`reminder_routing.py`；使用 `tender_guarantee.py` 的既有名单资料，调整受影响旧回归。

**Interfaces:** `evaluate_quantity(database,project,stage_key:str,lot_id:int|None=None)->dict`，返回 `{status,phase,actual_count,required_count,missing_count,rule_source,fingerprint,decision}`；`confirm_quantity(database,project,payload:dict,actor:str)->dict`；`validate_stage_advance(database,project,stage_key:str,actor:str|None=None)->dict|None`；`quantity_rule_for_scope(database,project,lot=None)->dict`。状态限定 `unfixed/pending/satisfied/shortage/confirmed`，阶段按业务模块识别。

- [ ] **Step 1 — 写失败测试：** 报名4、已接收2、有效1的同一夹具在对应阶段必须分别得到4/2/1；未参加/无文件/拒收排除，名单未核对为pending。不固定数量不警告，项目/包覆盖和例外选择保留依据。`test_cutoff_does_not_terminate` 断言截止后项目和包仍active；旧已流标不恢复。
- [ ] **Step 2 — 验证红灯：** `py -3.12 -m unittest tests.test_supplier_quantity tests.test_supplier_quantity_api -v`，预期接口缺失或旧自动流标断言失败。
- [ ] **Step 3 — 实现：** 新表 `supplier_quantity_decisions` 保存确认、规则/名单指纹、操作者及理由；服务端重新算指纹，拒绝伪造或过期确认。替换截止时自动流标为幂等预警；固定不足仍能保存普通资料，完成/推进时要求处理。所有手动、批量、直接 API 和后台自动完成入口统一调用同一门控；自动任务遇到pending/shortage只保留待办，不调用人工确认。
- [ ] **Step 4 — 验证绿灯：** 运行新测试及 `tests.test_lot_supplier_risk tests.test_lot_supplier_api tests.test_lot_supplier_email tests.test_stage_auto_completion tests.test_stage_workflow`。增加确认后名单、规则、包关联变化使确认失效测试；重复点击只记一次有效决定。邮件预览称“配置最低数量”和“待人工处理”，不得产生自动流标事件或真实邮件。
- [ ] **Step 5 — 提交：** 仅暂存本任务文件；`git commit -m "feat: require human decisions for supplier quantity shortages"`。

### Task 4：单项目流程预览和调整

**Files:** 新建 `src/backend_patches/project_workflow_editor.py`、`tests/test_project_workflow_editor.py`；修改 `procurement_api.py`、`stage_templates.py`。依赖检查读取保证金、期限、检查清单及已存在业务关联，不另造第二份业务数据。

**Interfaces:** `preview_project_flow(database,project,stages:list)->dict`；`apply_project_flow(database,project,stages:list,base_fingerprint:str,actor:str)->dict`；`stage_dependencies(database,project,stage_key:str)->list[dict]`。`diff` 分列 added/updated/removed，`blocked` 包含 stage_key 与具体依赖；确认事务重新校验全部条件。

- [ ] **Step 1 — 写失败测试：** 新增/重排仅改目标项目；完成阶段删除、改名、改模块被拒绝；有报名、结果、附件、检查清单、保证金起算或期限依赖的阶段不能直接移除；预览不得写库，项目在预览后变化返回409且无部分写入。
- [ ] **Step 2 — 验证红灯：** `py -3.12 -m unittest tests.test_project_workflow_editor -v`，预期缺少编辑服务失败。
- [ ] **Step 3 — 实现：** 复用阶段规范化和快照序列化，已完成行保留原记录；只对允许的未完成行增改，依赖移除列明原因。项目修改后增加workflow_revision、写审计、使相关派生缓存失效；全局模板保存完全不调用项目修改。
- [ ] **Step 4 — 验证绿灯：** 同一命令通过，再运行 `tests.test_stage_template_runtime tests.test_stage_locations tests.test_business_deadlines tests.test_guarantee_template_integrity`；断言调整后进度、日历阶段链接与保证金起算引用仍指向同一阶段标识。
- [ ] **Step 5 — 提交：** `git commit -m "feat: preview and safely edit individual project workflows"`（显式暂存本任务文件）。

### Task 5：管理界面、项目选择器和操作反馈

**Files:** 新建 `source/frontend/22-procurement-methods.js`、`23-project-flow-editor.js`、`src/project_manager/static/css/procurement-methods.css`、`tests/test_procurement_methods_ui.js`、`tests/test_project_flow_editor_ui.js`；修改 `manifest.json`、`01-core.js`、`02-projects.js`、`04-project-workflow.js`、`05-views.js`、`06-admin.js`、`07-business.js`、`09-command-center.js`、`11-stage-settings.js`、`12-settings-navigation.js`、`14-online-bidding.js`、`08-bootstrap.js`。

**Interfaces:** `loadProcurementCatalog({refresh=false}={})`；`procurementMethodOptions({purpose='create',project=null,regime=null}={})`；`renderProcurementMethodManager(catalog)`；`showProcurementMethodForm(id=null)`；`showProjectWorkflowEditor(projectId)`；`createStageEditorState(rows)`；`renderStageEditor(state,{editable=true}={})`。目录缓存按revision更新，所有草稿按id管理。用途区分create/change/reprocure/history，history保留停用和迁移状态；过滤/看板不能按同名方式混成一组。

- [ ] **Step 1 — 写失败测试：** jsdom 覆盖五制度筛选、启停/引用按钮、居中弹窗、同名标识、规则模式显隐、例外说明、通用/独立模板切换；新增不固定默认、新建制度待确认提示；历史停用方式回显与普通保存；项目流程预览/确认/取消、409保留输入。断言列表排序过滤后只交换当前可见相邻项。
- [ ] **Step 2 — 验证红灯：** `node --test tests/test_procurement_methods_ui.js tests/test_project_flow_editor_ui.js`，应因缺少新组件或旧静态候选失败。
- [ ] **Step 3 — 实现：** 移除重复数量卡片和批量同步按钮，复用现有主题/弹窗/选择组件；新建请求发送稳定标识。阶段编辑器同时用于独立模板与项目调整；对数量pending/shortage显示直接操作，不跳到无关页面。旧 `METHODS` 只保留迁移种子，不作运行时下拉来源；竞价功能按项目模块/内置类型识别。CSS 使用主题变量，长名称换行，数字文本输入配inputmode，保存反馈不重建整个设置页。
- [ ] **Step 4 — 验证绿灯：** 同一命令全部通过；`node tools/build_frontend.js --write` 后 `npm run check` 与 `npm test` 通过。检查四主题、键盘/焦点、关闭未保存确认、输入错误不丢草稿、恶意HTML纯文本显示；更改相关旧测试为新的业务预期，不能为过回归保留已取消的自动流标/批量同步入口。
- [ ] **Step 5 — 提交：** 包含重新生成的 `src/static/app.js` 及构建产生的样式产物；`git commit -m "feat: manage procurement methods and project flows in themed UI"`。

### Task 6：导入导出、重新采购、提醒和期限联动

**Files:** 修改 `data_import.py`、`app_replacements.py` 的项目导出、`lot_supplier_risk.py` 的重新采购、`business_deadlines.py`、`deadline_rules.py`、`tender_guarantee.py` 的方式引用读取；增加 `tests/test_procurement_catalog_integrations.py`；扩展已有导入、竞价、批量、侧栏、看板与邮件测试。

**Interfaces:** 消费目录解析/快照；增加 `reference_method_key(project)->str|None`，仅将已保存的内置类型映射到原规则语义，新增名称不擅自获得旧内置法定规则。`deadline_regime_for_management(regime:str)->str` 显式映射到原期限助手四类别；集体/其他为custom且保留原业务标签，已有项目配置优先。

- [ ] **Step 1 — 写失败测试：** 当前目录生成导入选项；旧表头唯一名称成功、跨制度同名缺制度逐行失败、停用/未知拒绝创建；导出后往返稳定标识、制度与名称快照。重新采购引用新方式阻止删除；竞价改名仍可使用既有台账；新项目制度可预填但不启用/确认期限，原期限设置不覆盖。
- [ ] **Step 2 — 验证红灯：** `py -3.12 -m unittest tests.test_procurement_catalog_integrations -v`，应因固定目录或缺少快照列失败。
- [ ] **Step 3 — 实现：** 追加兼容的可选导出/导入字段“采购方式标识”“适用制度”，不重解释旧列；所有导入路径同事务绑定项目。目录对象批量读取，不对每个项目重复全表查询。按项目/采购包快照生成提醒，不读取当前默认值替换历史规则；取消自动流标邮件模板。对接现有名单、保证金和期限助手，不推断新的法律数量或期限。
- [ ] **Step 4 — 验证绿灯：** `py -3.12 -m unittest tests.test_procurement_catalog_integrations tests.test_data_import tests.test_import_header_regressions tests.test_deadline_rules tests.test_business_deadlines tests.test_lot_supplier_email tests.test_online_bidding -v` 通过；名称 `=1+1`、`<img ...>` 和长文本导出仍为安全文本；运行 `node --test tests/test_sidebar_method_filter.js tests/test_dashboard_method_grouping.js tests/test_batch_advance_by_method.js tests/test_import_export_frontend.js tests/test_online_bidding_ui.js`，确保同名不同制度不混用。
- [ ] **Step 5 — 提交：** `git commit -m "feat: unify procurement method references across imports and reminders"`（显式暂存本任务文件）。

### Task 7：实际成品验收与本地交付

**Files:** 新建 `tools/verify_procurement_methods_release.py`、`docs/procurement-methods.md`；修改 `tools/compile_module_patches.py`、`package.json`、`package-lock.json`、README、CHANGELOG、使用说明与 `docs/releases/` 对应版本清单；交付记录放既有编号目录。

**Interfaces:** 验收脚本参数 `--candidate PATH --sha256 HASH --fixtures PATH --output PATH --old-exe PATH`，复用 `PackagedClient` 和无头 Playwright，只启动脚本拥有的隔离副本。产出JSON检查清单、请求/响应耗时、脚本错误、四主题与多宽度截图，不接管原桌面窗口。

- [ ] **Step 1 — 增加成品回归场景：** 用v5.8.36隔离副本准备历史项目、完成阶段、名单、中标、保证金/期限和停用方式夹具，保存基线；候选升级后核对业务行不变。走新增→数量/例外→独立模板→新项目→实际参与→不足确认→日历打开→单项目调整→导入导出→备份恢复→重启；原已流标和已完成项目保持原结果。
- [ ] **Step 2 — 验证旧成品拒绝新能力：** 对旧EXE运行同一新接口能力检查，预期明确不支持，记录失败证据；不得因缺少许可证、端口冲突或夹具失败而宣称红灯有效。
- [ ] **Step 3 — 构建候选：** 暂定发布版本v5.8.37，实施前核对未被其他任务占用。使用 `py -3.12 tools/build_local_upgrade.py --source-exe <v5.8.36兼容EXE> --source-sha256 <该EXE实际SHA256> --destination _build/procurement-methods/compatible.exe --report _build/procurement-methods/compatible-integrity.json`；公开版使用 `tools/build_public.py` 的相同四个参数，输入改为v5.8.36公开EXE，输出 `public.exe` 和 `public-integrity.json`。新增模块签名与版本来源检查通过，原授权/数据密钥模块校验保持一致；不复制私钥、真实数据库或邮件配置到公开包。
- [ ] **Step 4 — 最终绿灯：** `py -3.12 -m unittest discover -s tests`、`npm run check`、`npm test` 和候选脚本全部通过；记录确切通过/跳过数。截图审查四主题、1366/1920/768/390宽度及长名称、滚动；测日历点开阶段和设置开关，比较同一环境基线的中位数/P95，新增入口先给可见反馈，不能新增明显请求瀑布或全项目重载。原生WebView/Excel/WPS未人工验收时明确列出。
- [ ] **Step 5 — 交付与发布：** 本地 `04-发布成品` 带版本号中文兼容成品及单独公开成品，`06-分版本源码` 快照，`07-完整仓库备份` bundle，`05` 验证记录，更新 `00` 当前版本/交接及版本索引；核对哈希与source/runtime提交。完成本地后再同步GitHub公开源码、中文资产标签及5附件，CI和授权工具验收通过后发布，下载校验文件验证并回填远端记录。不得自动替换/重启 `E:/系统/项目系统` 的现有程序。
- [ ] **Step 6 — 提交与终验：** 审查本分支完整diff与每项设计要求，确认无遗留固定目录消费者或自动流标旁路；提交最终文档/版本清单，按本地优先流程合入主线，交付链接和测试边界如实报告，不把计划复核当作功能验收。

## 计划自审与执行交接

七个任务覆盖设计中的目录CRUD/制度隔离、数量/例外/人工确认、模板/项目调整、历史与持久化、全入口联动、主题与性能、实际成品验证和本地优先交付。Review Focus 五项均已分配到对应测试步骤。服务接口和状态值在后续任务沿用同一名称，写入统一使用调用方事务。

本计划尚未执行；本轮只编写和审阅计划，不更改正式版本号或当前成品。建议本会话直接实施（Native），因为目录、快照和阶段门控共享接口且改动较集中，减少并行接口漂移。按 writing-plans 技能要求，需用户审阅计划并选择执行方式后开始产品代码与测试。
