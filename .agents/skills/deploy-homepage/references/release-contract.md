# HomePage 生产发布契约

## 不可跳过的门禁

1. 确认当前仓库、分支、Git 状态和用户授权范围；不得把无关改动混入发布说明。
2. 运行 `npm ci`、`npm ci --prefix server` 和 `npm run verify`。任何失败都停止。
3. 从 `D:\ObjectCode\Server-infra\server.local.env` 读取连接信息，实时核对主机身份、磁盘、服务、监听端口和 Nginx 完整配置。不得记录秘密值。
4. 盘点 Nginx 当前路由的所有项目，为每个既有域名/健康端点记录发布前基线。HomePage 之外的站点不得因本次发布变化。
5. 上传后核对前后端 tar 包 SHA-256；没有匹配不得解包或切换。

## 发布身份

- 每次发布生成唯一 `release_id`；manifest 至少包含前后端哈希、文件数、字节数、Node/npm 版本、Git 状态和构建时间，并记录自身 SHA-256。
- 干净工作区用 Git commit 作为 API revision；用户明确授权的脏工作区用 `worktree-<server-sha12>`。manifest 哈希负责唯一标识完整前后端组合。
- 把 revision 写入 API 的 `SERVICE_REVISION`，但不覆盖仓库外已有秘密。

## 后端阶段

1. 解包到 `/opt/homepage-api/releases/<release_id>`，运行生产依赖安装、远端 API 测试和生产依赖审计。
2. 以运行服务的用户设置目录所有权与最小可用权限。
3. 切换前先创建 SQLite 一致性 backup：使用 `better-sqlite3.backup()` 在线备份数据库，同时备份上传目录、当前环境文件和旧 release 指针。若本次变更涉及上传写入或数据库与文件必须严格同一时点，先冻结写入或短暂停止服务，再完成数据库与 uploads 的整体备份。
4. 在数据库副本上启动新代码完成 migration probe；检查 schema version、关键表计数和 `PRAGMA integrity_check`。不得用生产数据库试迁移。
5. 原子更新 `previous` 与 `current`，重启 `homepage-api.service`。验证失败立即把 `current` 指回旧 release、恢复环境文件并重启；只有数据迁移已影响生产数据时才使用数据库 backup 回滚。
6. 验证本机及公开 `/health` 的 version、revision、database readiness、schema 和 Turnstile 状态；确认生产 dev-login 返回 404，并检查近期 journal 错误。

## 前端阶段

1. 解包到新的临时目录，核对 `index.html`、文件数、总字节数和入口 SHA-256。
2. 将现有 `/var/www/xgwnje-home` 改名为带 `release_id` 的 backup，再把新目录改名为正式目录；设置失败陷阱恢复旧目录。
3. 验证源站和公网：首页、博客、标签、至少一篇中英文文章、后台、RSS、Sitemap 均返回预期状态；随机不存在路径必须返回 404。
4. 前端失败时删除未启用的新目录并恢复 backup；后端已健康时不要无理由连带回滚后端。

## Nginx 例外流程

静态文件替换不需要 reload。只有现有路由使发布验收失败，且用户已明确授权修改 Nginx 时，才执行：

1. 说明问题、受影响 server block 与其他项目隔离证据。
2. 将原配置备份到 Nginx include 目录之外。
3. 只改 HomePage 对应 server block；不得顺手重排共享 stream/SNI 或其他域名。
4. 运行 `nginx -t`，失败则恢复备份并停止。
5. reload 后重新验证所有发布前基线端点、服务与监听端口；任一其他项目变化都立即恢复配置、再次 `nginx -t` 并 reload。

## 最终验收与清理

- 用真实 Chrome 做桌面与移动端运行态验收；断图检查忽略空 `src` 占位，但任何非空失败 URL 都必须调查。
- 重新确认 `nginx -t`、服务状态、`current`/`previous`、前端入口哈希、API readiness、404 与各项目基线。
- 仅删除明确属于本次 `release_id` 的临时 tar、探针和本地临时目录；保留生产 release、数据库 backup、前端 backup 和 Nginx backup。
- 最终摘要必须列出：范围、release ID、revision、脏工作区状态、manifest/制品哈希、备份、切换结果、Nginx 变更、浏览器/接口验证、回滚命令入口、遗留问题。
