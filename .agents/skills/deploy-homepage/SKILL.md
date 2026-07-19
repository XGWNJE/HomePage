---
name: deploy-homepage
description: Release HomePage through a one-command content fast lane, a lightweight frontend path, or a full audit for software review and risky changes. Use when the user explicitly asks to publish an article, deploy, release, roll back, or verify a production HomePage release.
---

# HomePage 发布

将本仓库发布到 VPS，同时保护 SQLite 数据、共享 Nginx 路由和其他线上项目。开始前完整阅读 [发布契约](./references/release-contract.md)。发布安全底线保持不变，但验证强度按影响面分级。

## 1. 确认授权与范围

- 只有用户明确要求上线、发布或回滚时才改变生产环境。
- 默认只发布实际变更的部分。普通 `src/content/blog/*.md`、`public/image/blog/**` 中的安全图片和 `public/file/blog/**` 中的安全下载附件使用 `ContentOnly`；嵌套文章、`.mdx`、原生 HTML、组件、样式、脚本和其他静态前端变更使用 `FastFrontend`。不得为了沿用旧流程顺带发布未变更的 `server/`。
- 用户明确要求“软件审查”“完整验收”“全局验证”“端到端验证”时使用 `FullAudit`。
- 变更涉及 `server/`、认证、数据库、migration、依赖锁、构建配置、部署脚本、Nginx/DNS/端口/证书/防火墙，或影响边界不清楚、轻量门禁失败时，即使用户未点名也升级 `FullAudit`。
- 不自动 commit、push、tag 或创建 Release。
- 工作区应优先干净。若存在改动，只有用户已明确授权发布当前未提交内容时才继续，并以制品哈希标识发布。
- Nginx 仅在现有配置阻断正确行为时修改，且必须获得针对 Nginx 的明确授权。

## 2. 选择并执行本地门禁

文章快速发布要求工作区干净且内容 commit 已推送。脚本从生产 manifest 读取代码 revision，并校验该 revision 到当前 HEAD 的全部变更只含 Markdown 与文章专用资源——存在其他未上线工程提交时通道直接拒绝，提示改走前端或完整发布。校验通过后直接在主工作区构建。直接运行：

```powershell
npm run publish:content
```

该命令自动完成内容配对、本地链接与附件存在性检查、一次隔离生产构建、差量制品/manifest/SHA-256、独立制品上传、远端原子切换、文章路由验收、失败回滚与 `Server-infra AfterChange`。manifest 分别记录生产代码 revision 与内容来源 revision。远端 Bash 通过标准输入执行，不依赖 Windows SSH 对嵌套引号的传递。`npm run content:release:plan` 只看范围，`npm run content:release:benchmark` 构建差量制品但不上线。文章发布仍在本地构建完整静态站，但只传变化文件；它不会部署 API、修改 Nginx、运行 API 测试或执行全站浏览器矩阵。

先检查相对上一生产 revision 的变更路径与当前工作区；确认没有高风险路径后，纯前端发布运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/deploy-homepage/scripts/preflight.ps1 -Mode FastFrontend
```

`FastFrontend` 复用现有依赖，只运行 UI 复用约束、类型检查和生产构建；依赖缺失或锁文件变化时先运行 `npm ci`。不安装后端依赖、不运行 API 测试。

`FullAudit` 运行：

```powershell
npm ci
npm ci --prefix server
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/deploy-homepage/scripts/preflight.ps1 -Mode FullAudit
```

本仓库的首次全量上线或包含 API 的发布使用：

```powershell
npm run publish:full
```

该命令要求干净的 `main` 和已推送的 `origin/main`，没有跳过 preflight 的正式参数。它会重新执行 `npm ci`、完整门禁、前端与 API 制品哈希校验、后端生产依赖/测试/审计、SQLite 在线备份与 migration probe，再按 API、静态站顺序原子切换。API 切换前会核对 systemd 实际解析的 data/db/uploads/port 配置，停服务后创建即时 pre-migration 快照；新版本失败时只有在新服务完全停止后才原子恢复数据库、权限、环境和旧指针，并验证旧 revision/readiness。

若用户明确授权脏工作区，在单独运行 preflight 时添加 `-AllowDirty`。脚本只检查 `D:\ObjectCode\Server-infra\server.local.env` 的 `VPS_IP`、`SSH_USER`、`SSH_PORT`、`SSH_KEY_PATH` 和密钥文件存在性，不输出秘密；正式 preflight 不提供跳过验证参数。

## 3. 生成可追踪制品

- 生成 UTC `release_id`，记录变化文件、完整静态树文件数、字节数、入口哈希与树哈希；对差量包、传输包和 release manifest 分别计算 SHA-256。
- 干净工作区使用 Git commit 作为 API revision；已授权脏工作区使用 `worktree-<server-sha12>`，并以 manifest 哈希唯一标识前后端组合，同时在结果中标记未提交。
- 从 `D:\ObjectCode\Server-infra` 读取实时服务器资料；不得依赖旧 IP、旧 SSH 别名或把凭据写进仓库、日志、命令回显。

## 4. 分阶段发布

严格按发布契约中的当前档位执行。每一步先上传到新路径并验证，再切换 `current`/正式目录；版本化制品、SHA-256、备份、原子切换、回滚入口和 `Server-infra AfterChange` 在三个档位都不可省略。只有发布后端时才执行数据库、上传目录和环境文件备份；数据库恢复前还必须保留停止状态下的当前数据库与 sidecar，不能让回滚覆盖成为不可逆操作。

## 5. 验收与交付

- `ContentOnly` 只检查本次公开文章地址；完整静态树哈希保证首页、列表、标签、RSS 与 Sitemap 与本地构建一致。`.mdx`、自定义交互或布局不进入该档位。
- `FastFrontend` 只检查 API health、首页、404 和本次受影响路由；使用临时浏览器实例检查受影响页面（完成后关闭），响应式变更再补一个移动端视口。
- `FullAudit` 验证 systemd、Nginx、API readiness、数据库 schema、全部公开路由、404 语义和服务器上其他项目基线；按需要使用用户真实 Chrome 完整检查首页、博客、标签、文章、后台与移动端。
- 成功后仅清理已精确确认的本地/远端临时制品，保留版本目录和回滚备份。
- 汇报发布档位、release ID、revision、manifest/制品哈希、`current`/`previous`、备份路径、Nginx 变更、已运行与有意跳过的验证、回滚入口和未解决项。
