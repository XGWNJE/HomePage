# HomePage 生产发布契约

## 发布档位

- `ContentOnly`：文章快速通道，允许 `src/content/blog/*.md`、`public/image/blog/**` 中的安全图片和 `public/file/blog/**` 中的安全下载附件。嵌套文章、`.mdx`、原生 HTML、组件、样式、脚本、文章或附件删除、公开文章转草稿不进入该通道。线上生产 revision 到本地 `HEAD` 之间存在其他工程路径时，通道拒绝发布并提示升级档位，不得让未上线代码进入文章制品。
- `FastFrontend`：默认前端档位，适用于影响边界清晰的页面和视觉资产变更。
- `FullAudit`：用户明确要求软件审查、完整验收、全局或端到端验证时使用；后端、认证、数据库、migration、依赖锁、构建配置、部署脚本、共享基础组件或基础设施变更也必须使用。
- 轻量门禁失败、变更路径无法可靠归类或线上表现异常时，立即停止并升级 `FullAudit`，不得降低检查逃避失败。

## 所有档位共同的安全底线

1. 确认当前仓库、分支、Git 状态、相对上一生产 revision 的变更路径和用户授权范围；不得混入无关改动。
2. 从 `D:\ObjectCode\Server-infra\server.local.env` 读取连接信息并实时核对目标主机身份与磁盘空间，不得记录秘密值。
3. 上传后先核对传输包 SHA-256，再核对包内文件 SHA-256；没有匹配不得执行包内脚本、重建或切换。
4. 使用版本化 release、manifest、backup、`current`/`previous` 和失败回滚；不得原地覆盖现有文件。
5. 发布后运行 `D:\ObjectCode\Server-infra\scripts\maintain.ps1 -Mode AfterChange -Scope homepage`，确认前端没有新增 drift 或 unreachable；未改动的 API 不重复巡检。

## ContentOnly 门禁与验收

1. 要求干净工作区且内容 commit 已推送；读取生产 release manifest 的生产代码 revision 与上一内容来源 revision。用 Git 差异自动选择 Markdown 和文章专用资源，不依赖操作者手填范围；其他工程路径只记录为忽略项。
2. 从生产 manifest 读取代码 revision，校验该 revision 到 HEAD 的全部变更只含内容文件（普通 Markdown、文章专用图片与安全附件），再运行语言配对、文章资源契约、本地链接存在性检查和一次生产构建。构建直接在主工作区进行；校验发现代码改动时通道拒绝发布，提示改走前端或完整发布。草稿不生成公开文章路由。发布回归测试留在开发与 CI 门禁，不进入日常文章上线热路径。
3. 比较线上完整静态树和隔离构建的 `dist/`，只上传变化文件。差量 bundle 独立上传并核对哈希，远端部署脚本通过 `bash -s` 标准输入执行，避免 Windows SSH 命令行转义改变脚本内容。服务器复制上一 release 后应用变化与删除，核对文件数、总字节、入口哈希和完整树哈希；版本目录与线上目录不得共享可被运行时写入的 inode，也不得原地覆盖单篇 HTML。
4. 后端、SQLite、上传目录、环境文件与 Nginx 保持不变。
5. 切换后只验证本次公开文章路由并运行 `Server-infra AfterChange`；失败立即恢复静态 backup。首页、博客、标签、RSS 与 Sitemap 由完整树哈希保证与已通过构建的本地产物一致，不重复逐页探测。

## FastFrontend 门禁与验收

1. 复用现有依赖运行 `preflight.ps1 -Mode FastFrontend`；它执行 UI 复用约束、类型检查和生产构建。依赖缺失或锁文件变化时运行 `npm ci` 后重试。
2. 后端制品、服务、数据库、上传目录、环境文件和 Nginx 均保持不变。
3. 上传并核对前端制品 SHA-256、`index.html`、文件数、总字节数和入口哈希，再用带 `release_id` 的 backup 原子替换静态目录。
4. 线上只检查 API health、首页、随机 404 和本次受影响路由；仅当响应式行为变化时增加移动端视口。
5. 使用临时浏览器实例检查受影响页面的布局、资源与 Console（完成后关闭实例）；依赖真实登录态、扩展或 Chrome 特有行为时改用用户真实 Chrome。

## FullAudit 门禁与验收

1. 运行 `npm ci`、`npm ci --prefix server` 和 `preflight.ps1 -Mode FullAudit`；正式发布脚本和 preflight 均不提供跳过参数，任何失败都停止。
2. 实时核对服务、监听端口与 Nginx 完整配置，并为当前所有线上项目记录发布前基线。
3. 按本契约后续完整执行前后端、数据库、路由隔离与浏览器矩阵；未变更的部分可以不重新部署，但不能跳过受影响边界验证。

## 发布身份

- 每次发布生成唯一 `release_id`；manifest 至少包含生产代码 revision、内容来源 revision、内容叠加路径、被忽略工程路径、前后端哈希、文件数、字节数、Git 状态和构建时间，并记录自身 SHA-256。
- 干净工作区用 Git commit 作为 API revision；用户明确授权的脏工作区用 `worktree-<server-sha12>`。manifest 哈希负责唯一标识完整前后端组合。
- 把 revision 写入 API 的 `SERVICE_REVISION`，但不覆盖仓库外已有秘密。

## FullAudit 后端阶段

1. 解包到 `/opt/homepage-api/releases/<release_id>`，运行生产依赖安装、远端 API 测试和生产依赖审计。
2. 以运行服务的用户设置目录所有权与最小可用权限。
3. 从 `homepage-api.service` 当前 `MainPID` 的 `/proc/<pid>/environ` 读取真实运行环境，让新 release 的配置加载器失败关闭；只报告不匹配的变量名，不输出环境值。`HOMEPAGE_API_DATA_DIR`、`DATABASE_PATH`、`UPLOAD_DIR` 和 `PORT` 的有效值必须分别匹配部署脚本的 `/opt/homepage-api/data`、数据库、uploads 和 `8787` 假设，否则不得备份或切换。
4. prepare 阶段使用 `better-sqlite3.backup()` 创建只供 migration probe 的在线 SQLite 副本，同时备份当前环境文件、旧 release 指针和旧健康 revision；不得把此副本与另一个时点的 uploads 归档描述成一致恢复点。严格恢复点统一在激活停服后创建。
5. 在数据库副本上启动新代码完成 migration probe；迁移前后都执行 `PRAGMA integrity_check`，记录完整非 SQLite 内部 schema 和全部当前持久表计数，要求旧 schema 对象仍存在、旧表行数不变且最终 schema version 等于代码版本。不得用生产数据库试迁移。
6. 激活时先停止 `homepage-api.service` 并确认 `MainPID=0`，再创建即时 pre-migration SQLite 快照、记录数据库 owner/mode，并为不可变 uploads 创建同文件系统硬链接快照，然后更新环境和 `previous`/`current`、启动新服务。验证失败或立即回滚时先停止新服务并再次确认无数据库使用者，把当前 SQLite、sidecar 和 uploads 保存到本次备份的 `rollback-current-*` 目录，再成对原子恢复激活时的数据库与 uploads；最后恢复旧环境与 `current`、启动旧服务并验证旧 revision/readiness。任何保护或恢复步骤失败都不得覆盖数据或把服务当作已回滚。
7. 验证本机及公开 `/health` 的 version、revision、database readiness、schema 和 Turnstile 状态；确认生产 dev-login 返回 404，并检查近期 journal 错误。

## 前端切换

1. 解包到新的临时目录，核对 `index.html`、文件数、总字节数和入口 SHA-256。
2. 将现有 `/var/www/xgwnje-home` 改名为带 `release_id` 的 backup，再把新目录改名为正式目录；设置失败陷阱恢复旧目录。
3. `ContentOnly` 验证公网变更文章；`FastFrontend` 验证首页、受影响路由、API health 和随机 404；`FullAudit` 追加全部公共入口与后台。
4. 前端失败时删除未启用的新目录并恢复 backup；API helper 在本机激活或健康失败时自行安全回滚，但一旦 API 激活返回成功，后续公网、前端或 AfterChange 失败不得自动回退数据库。发布器应保留健康 API、回滚受影响前端并明确报告部分发布状态。

## Nginx 例外流程

静态文件替换不需要 reload。只有现有路由使发布验收失败，且用户已明确授权修改 Nginx 时，才执行：

1. 说明问题、受影响 server block 与其他项目隔离证据。
2. 将原配置备份到 Nginx include 目录之外。
3. 只改 HomePage 对应 server block；不得顺手重排共享 stream/SNI 或其他域名。
4. 运行 `nginx -t`，失败则恢复备份并停止。
5. reload 后重新验证所有发布前基线端点、服务与监听端口；任一其他项目变化都立即恢复配置、再次 `nginx -t` 并 reload。

## 最终验收与清理

- `ContentOnly` 只接受普通 Markdown，不做浏览器验收；自定义交互、嵌入或特殊布局升级 `FastFrontend`。`FastFrontend` 用临时浏览器实例检查受影响页面（完成后关闭）；`FullAudit` 用用户真实 Chrome 做桌面与移动端运行态验收。断图检查忽略空 `src` 占位，但任何非空失败 URL 都必须调查。
- 三档都重新确认 `current`/`previous` 与前端入口哈希；`FastFrontend` 追加 API readiness 与 404，`FullAudit` 再追加 `nginx -t`、服务状态和各项目基线。
- 仅删除明确属于本次 `release_id` 的临时 tar、探针和本地临时目录；保留生产 release、数据库 backup、前端 backup 和 Nginx backup。
- 最终摘要必须列出：档位、范围、release ID、revision、脏工作区状态、manifest/制品哈希、备份、切换结果、Nginx 变更、已运行与跳过的浏览器/接口验证、回滚命令入口、遗留问题。
