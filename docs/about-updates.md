# 关于页面与版本检查

本功能在原“系统设置 → 关于”内实现，保留现有主题、字体和卡片组件。桌面客户端分为软件信息、版本更新、更新日志三个区域；网页版只显示软件信息，不显示版本更新与更新日志，也不读取更新源或请求GitHub，包括同机浏览器访问。其他设置分类的内容与行为不变。

## 架构与修改范围

| 文件 | 作用 |
| --- | --- |
| `source/frontend/06-admin.js` | 原关于页面的三个区域，进入关于后初始化配置 |
| `source/frontend/12-settings-navigation.js` | 仅关于分类显示“查看系统版本、更新记录及相关信息” |
| `source/frontend/25-about-updates.js` | 按需异步请求GitHub、数字版本比较、加载/错误状态、日志翻页、下载页入口 |
| `src/project_manager/static/css/about-updates.css` | 限定于关于页面的主题变量样式和窄屏布局 |
| `source/frontend/manifest.json` | 将新JS/CSS接入现有构建 |
| `src/backend_patches/software_updates.py` | 只读更新源接口及本机默认浏览器打开接口，不访问业务数据库 |
| `src/backend_patches/desktop_app_replacements.py` | 为EXE的现有Flask应用注册上述两个接口 |
| `tools/compile_module_patches.py` | 将更新源配置和新增模块编入现有EXE补丁流程 |
| `package.json`、`package-lock.json` | 唯一软件版本及公开更新源配置；没有新增依赖 |
| `src/static/app.js`、`src/project_manager/static/app.js`及两份`style.css` | 按既有流程生成，不手工维护 |
| `tests/test_software_updates.js`、`tests/test_software_updates.py` | 更新、错误、权限及配置打包验证 |
| `tests/test_local_network_boundary.js` | 为关于页增加唯一、无凭据的GitHub请求例外；其他模块继续只访问本地API |
| `tools/verify_about_updates_release.py` | 在隔离数据的真实EXE中检查页面、网络情形和其他设置分类 |

应用是原生JavaScript单页界面和Flask后端，桌面端使用pywebview并以PyInstaller运行时打包。历史核心仍为编译运行时，不能脱离基座从零构建完整后端。新增代码只涉及关于页面及必要的配置、路由和打包支持。

## 版本与更新源

`package.json.version`是唯一版本配置，既有编译流程将其写入`/api/system-info`与`/health`。关于页显示运行服务实际报告的版本，不另存一个固定版本字符串。

更新源集中在同一个`package.json`的`softwareUpdates`字段：

```json
{
  "enabled": true,
  "owner": "GitHub账号或组织名",
  "repository": "仓库名称"
}
```

配置只包含可公开的仓库信息，不支持或需要客户端访问令牌。构建时将这三个字段嵌入新增模块，不依赖开发电脑上的文件路径；缺失、禁用或无效配置显示“尚未配置更新源”。修改源后需要重新构建EXE。本功能不写入原设置文件或数据库。

当前项目公开仓库已配置，不需要服务器或官网。如果以后改为私有仓库，匿名访问会受限；应提供公开发布源，而不是把私有令牌写进客户端，也不会由本功能公开仓库。

## 检查行为

- 桌面客户端通过既有本机桌面标记和pywebview原生桥接共同识别；桥接延迟就绪时自动补齐关于区控件。网页端不提供更新功能，不修改其他模块的桌面判断。
- 客户端打开关于页只读取本机的更新源配置。只有点击“检查更新”或“查看更新日志”才访问GitHub。
- 使用Releases API的`/releases/latest`与`/releases?per_page=10&page=N`。请求由当前客户端浏览器异步执行，10秒超时；不携带本地Cookie、GitHub登录凭据或Authorization头，不阻塞Flask服务或业务界面。
- 接受`v5.8.42`、`v5.8.42-public`等正式标签，按三个数字段比较，`-public`仅为本项目发行后缀。草稿和预发布不作为可用正式更新。无法识别版本时明确提示，不猜测版本。
- 相同版本显示“当前已是最新版本”；本地高于远端时说明本地版本高于最新发布版本；发现新版时显示版本、发布日期、说明及“前往下载”。
- 网络失败、超时、403/429限流、5xx、空发布和仓库不存在/私有分别显示提示。更新失败不影响软件信息或其他设置，已经读到的日志可继续显示。
- 日志展示正式版本、发布日期和说明，每页10条，支持加载更早版本。远端内容以文本安全展示，不能执行HTML、脚本或外部图片。
- 下载地址只能由配置中的GitHub仓库与标签组成，不接受远端任意URL。本机EXE通过本地受登录及CSRF保护的接口打开系统默认浏览器；网页版不显示下载入口。
- 只打开发布详情页，不自动下载、安装或替换EXE。现有公开版与原授权兼容版不能混用，下载区域会提示核对适用范围。

## 后续在GitHub发布新版本

1. 先将`package.json.version`改为新版本，例如`5.8.43`，同步锁文件版本，按既有流程构建、测试并完成本地交付。运行时、源码及关于页版本必须一致。
2. 完成本地中文命名源码快照、成品、完整包、校验和验收记录，再执行本地交付收尾命令。保留最近三版；构建失败不淘汰旧版。
3. 将需要发布的源码提交同步到项目GitHub仓库，打开仓库的 **Releases → Draft a new release**。
4. 创建标签，例如`v5.8.43-public`，目标选择该版已经验证的源码提交；标题写`v5.8.43`。正文填写该版本的新增、修复、优化内容，这段正文即关于页的更新说明。
5. 上传对应的**公开版**系统EXE、两种公开授权工具EXE、完整发布包和SHA256校验文件。使用英文下载名与中文显示标签的现有映射；不要上传本地兼容EXE、私钥、许可证、真实数据或邮箱配置。
6. 取消预发布选项，将正式版本设为 **Latest/最新发布**，点击 **Publish release**。草稿、普通Git标签及未发布的本地文件不会被版本检查发现。
7. 在旧版本系统的关于页点击“检查更新”，核对新版本、说明和发布页链接。随后回填本地的远端发布结果。

本轮开发只做本地交付，不代替用户发布GitHub。未发布的本地新版高于当前GitHub版本时，关于页会如实说明，不虚构远端新版。

GitHub官方说明：<https://docs.github.com/en/rest/releases/releases>。

发布本轮已经构建好的成果时使用`v5.8.42-public`及其本地提交，无需再次升版；上面的v5.8.43是下一轮开发示例。先推送对应源码提交及标签，再在GitHub选择该标签创建正式Release。
