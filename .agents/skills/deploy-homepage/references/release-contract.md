# HomePage 生产发布契约

## 发布档位

- `ContentOnly`：文章快速通道，仅允许 `src/content/blog/**` 与 `public/image/blog/**`；从线上 manifest 的生产 revision 到本地 `HEAD` 之间出现其他路径时拒绝发布。
- `FastFrontend`：默认前端档位，适用于影响边界清晰的页面和视觉资产变更。
- `FullAudit`：用户明确要求软件审查、完整验收、全局或端到端验证时使用；后端、认证、数据库、migration、依赖锁、构建配置、部署脚本、共享基础组件或基础设施变更也必须使用。
- 轻量门禁失败、变更路径无法可靠归类或线上表现异常时，立即停止并升级 `FullAudit`，不得降低检查逃避失败。

## 所有档位共同的安全底线

1. 确认当前仓库、分支、Git 状态、相对上一生产 revision 的变更路径和用户授权范围；不得混入无关改动。
2. 从 `D:\ObjectCode\Server-infra\server.local.env` 读取连接信息并实时核对目标主机身份与磁盘空间，不得记录秘密值。
3. 上传后核对本次制品 SHA-256；没有匹配不得解包或切换。
4. 使用版本化 release、manifest、backup、`current`/`previous` 和失败回滚；不得原地覆盖现有文件。
5. 发布后运行 `D:\ObjectCode\Server-infra\scripts\maintain.ps1 -Mode AfterChange -Scope homepage,homepage-api`，确认无新增 drift 或 unreachable。

## ContentOnly 门禁与验收

1. 要求干净工作区；读取生产 release manifest 的 revision，使用 `git diff <production-revision>..HEAD` 判定完整发布差异，不依赖操作者手填范围。
2. 运行语言配对、文章/图片发布契约和生产构建；草稿不生成公开文章路由。
3. 即使只更新一篇文章，也发布完整 `dist/`，使首页、博客、标签、RSS 与 Sitemap 原子保持一致；不得原地覆盖单篇 HTML。
4. 后端、SQLite、上传目录、环境文件与 Nginx 保持不变。
5. 验证所有变更文章路由、相关标签、首页、博客、RSS、Sitemap、API health 与随机 404；失败立即恢复静态 backup。

## FastFrontend 门禁与验收

1. 复用现有依赖运行 `preflight.ps1 -Mode FastFrontend`；它执行 UI 复用约束、类型检查和生产构建。依赖缺失或锁文件变化时运行 `npm ci` 后重试。
2. 后端制品、服务、数据库、上传目录、环境文件和 Nginx 均保持不变。
3. 上传并核对前端制品 SHA-256、`index.html`、文件数、总字节数和入口哈希，再用带 `release_id` 的 backup 原子替换静态目录。
4. 线上只检查 API health、首页、随机 404 和本次受影响路由；仅当响应式行为变化时增加移动端视口。
5. 使用 Codex 内置浏览器检查受影响页面的布局、资源与 Console；依赖真实登录态、扩展或 Chrome 特有行为时改用真实 Chrome。

## FullAudit 门禁与验收

1. 运行 `npm ci`、`npm ci --prefix server` 和 `preflight.ps1 -Mode FullAudit`；任何失败都停止。
2. 实时核对服务、监听端口与 Nginx 完整配置，并为当前所有线上项目记录发布前基线。
3. 按本契约后续完整执行前后端、数据库、路由隔离与浏览器矩阵；未变更的部分可以不重新部署，但不能跳过受影响边界验证。

## 发布身份

- 每次发布生成唯一 `release_id`；manifest 至少包含前后端哈希、文件数、字节数、Node/npm 版本、Git 状态和构建时间，并记录自身 SHA-256。
- 干净工作区用 Git commit 作为 API revision；用户明确授权的脏工作区用 `worktree-<server-sha12>`。manifest 哈希负责唯一标识完整前后端组合。
- 把 revision 写入 API 的 `SERVICE_REVISION`，但不覆盖仓库外已有秘密。

## FullAudit 后端阶段

1. 解包到 `/opt/homepage-api/releases/<release_id>`，运行生产依赖安装、远端 API 测试和生产依赖审计。
2. 以运行服务的用户设置目录所有权与最小可用权限。
3. 切换前先创建 SQLite 一致性 backup：使用 `better-sqlite3.backup()` 在线备份数据库，同时备份上传目录、当前环境文件和旧 release 指针。若本次变更涉及上传写入或数据库与文件必须严格同一时点，先冻结写入或短暂停止服务，再完成数据库与 uploads 的整体备份。
4. 在数据库副本上启动新代码完成 migration probe；检查 schema version、关键表计数和 `PRAGMA integrity_check`。不得用生产数据库试迁移。
5. 原子更新 `previous` 与 `current`，重启 `homepage-api.service`。验证失败立即把 `current` 指回旧 release、恢复环境文件并重启；只有数据迁移已影响生产数据时才使用数据库 backup 回滚。
6. 验证本机及公开 `/health` 的 version、revision、database readiness、schema 和 Turnstile 状态；确认生产 dev-login 返回 404，并检查近期 journal 错误。

## 前端切换

1. 解包到新的临时目录，核对 `index.html`、文件数、总字节数和入口 SHA-256。
2. 将现有 `/var/www/xgwnje-home` 改名为带 `release_id` 的 backup，再把新目录改名为正式目录；设置失败陷阱恢复旧目录。
3. `ContentOnly` 验证源站与公网的变更文章、相关标签、首页、博客、RSS、Sitemap、API health 和随机 404；`FastFrontend` 验证首页、受影响路由、API health 和随机 404；`FullAudit` 追加全部公共入口与后台。
4. 前端失败时删除未启用的新目录并恢复 backup；后端已健康时不要无理由连带回滚后端。

## Nginx 例外流程

静态文件替换不需要 reload。只有现有路由使发布验收失败，且用户已明确授权修改 Nginx 时，才执行：

1. 说明问题、受影响 server block 与其他项目隔离证据。
2. 将原配置备份到 Nginx include 目录之外。
3. 只改 HomePage 对应 server block；不得顺手重排共享 stream/SNI 或其他域名。
4. 运行 `nginx -t`，失败则恢复备份并停止。
5. reload 后重新验证所有发布前基线端点、服务与监听端口；任一其他项目变化都立即恢复配置、再次 `nginx -t` 并 reload。

## 最终验收与清理

- `ContentOnly` 默认以构建和 HTTP 路由验收为主；文章含自定义交互、嵌入或特殊布局时再用浏览器检查。`FastFrontend` 用 Codex 内置浏览器检查受影响页面；`FullAudit` 用真实 Chrome 做桌面与移动端运行态验收。断图检查忽略空 `src` 占位，但任何非空失败 URL 都必须调查。
- 两档都重新确认 `current`/`previous`、前端入口哈希、API readiness 与 404；`FullAudit` 追加 `nginx -t`、服务状态和各项目基线。
- 仅删除明确属于本次 `release_id` 的临时 tar、探针和本地临时目录；保留生产 release、数据库 backup、前端 backup 和 Nginx backup。
- 最终摘要必须列出：档位、范围、release ID、revision、脏工作区状态、manifest/制品哈希、备份、切换结果、Nginx 变更、已运行与跳过的浏览器/接口验证、回滚命令入口、遗留问题。
