# XGWNJE 站点维护

本文负责内容、本地前端验证和静态站发布。架构边界见 [架构说明](./architecture.md)，后端生产操作见 [后端维护](./backend-maintenance.zh-CN.md)。

## 本地准备

使用 lockfile 安装依赖：

```powershell
npm ci
npm ci --prefix server
```

启动前端：

```powershell
npm run dev -- --host 127.0.0.1
```

需要联调登录、评论、浏览量或联系表单时，再按 [后端开发](./backend-development.md) 启动本地 API。

## 发布文章

文章位于 `src/content/blog/`。同一主题的中文和英文版本分别使用 `-cn`、`-en` 文件名，并共享同一个 `group`：

用户确认普通文章上线后，如果缺少对应英文版，默认直接创建忠实英文稿，并保持 `group`、发布日期、分类、标签和事实边界一致。补齐后运行中英文配对检查并继续上线，不再为英文稿单独设置确认节点。

```yaml
---
title: "文章标题"
description: "文章摘要"
pubDate: 2026-07-10
updatedDate: 2026-07-10
lang: "cn"
author: "XGWNJE"
group: "same-article-group"
tags: ["Engineering", "Notes"]
important: false
importantOrder: 0
draft: false
---
```

维护规则：

- 两种语言的 `group`、标签语义和发布日期保持一致。
- `important: true` 的文章用 `importantOrder` 控制顺序。
- 快速发布使用的文章专用图片放在 `public/image/blog/<article-group>/`；PDF、数据文件等下载附件放在 `public/file/blog/<article-group>/`。共享站点资产继续通过既有资产入口维护。
- 外部图片迁移前先验证目标域名、对象完整性和回滚；不得批量猜测替换。
- 发布前检查构建产物没有草稿文章。

### Markdown 与 MDX

- 常规文章使用 `.md`；内容源不是 JSON。`.mdx` 只在需要导入 Astro 文章组件、原生 HTML 或构建期计算数据时使用。
- 站点已支持 GitHub 风格表格、任务列表、语言标注的代码块、`NOTE` / `TIP` / `IMPORTANT` / `WARNING` / `CAUTION` 提示框，以及正文图片预览。
- 可复用的 MDX 组件放在 `src/components/article/`。`.mdx` 会进入普通前端发布；`ContentOnly` 只接受不包含组件逻辑的 `.md`。
- Mermaid、公式渲染、视频/PDF 嵌入和第三方交互图表目前不是已接通能力；需要时先实现集中组件并验收，再在文章中复用。

### 章节导航与短文布局

审核稿不设统一标题数量。至少两个可识别章节标题时，文章页自动显示桌面目录和移动端目录；零个或一个标题时自动使用无目录的居中阅读布局。章节标题优先写成符合语气的自然过渡句，不使用空标题、HTML 隐藏标题或只为凑目录存在的章节。

布局由 Markdown 标题自动判断，不需要 frontmatter。首次修改这套共享布局时运行完整验证；后续普通 `.md` 文章仍走 `ContentOnly`，不因文章选择目录布局或居中布局而重复前端完整验证或浏览器矩阵。

### 文章效果的决策顺序

用户或作者提出“想要某种效果”时，不直接默认新建组件。先查 [`visual-system/ui-reuse.zh-CN.md`](./visual-system/ui-reuse.zh-CN.md) 的组件地图，并按下表选择满足需求的最低成本路径：

| 路径 | 适合情况 | 主要限制 | 发布影响 |
| --- | --- | --- | --- |
| Markdown 基础样式 | 标题、列表、表格、任务清单、代码、引用、提示框、普通图片 | 不适合复杂信息布局和交互 | `.md` 可走 `ContentOnly` |
| 已有 MDX 组件 | 指标概览、步骤时间线、静态柱状图、方案对比 | 受现有 Props 和布局能力约束 | 普通前端发布 |
| 扩展已有组件 | 现有组件只缺一个可复用状态、字段或 slot | 需要代码验证，并影响所有调用方 | 前端发布；不能走 `ContentOnly` |
| 静态图片 | 一次性、内容固定、装饰性强或制作成图明显更省成本的图表与示意图 | 不会自动适配数据、主题和语言；可访问性较弱 | 图片放在文章专用目录时可走 `ContentOnly` |
| 新建组件 | 会重复使用，或必须数据驱动、交互、响应式、主题适配、多语言和可访问语义 | 开发、测试和长期维护成本最高 | 前端发布；组件上线后后续文章可快速复用 |

实施前应先向用户说明三件事：

1. **支持判断**：已原生支持、已有组件、可用图片替代，还是确实需要新组件。
2. **推荐方案**：为什么选择基础样式、已有组件、图片或新组件；一次性效果优先考虑图片的性价比。
3. **发布后果**：只改文章/专用图片可走 `ContentOnly`；新增或修改组件必须升级前端发布。

静态图片不能成为重要信息的唯一载体。图表或流程图应在正文保留结论、关键数据或等价表格，图片提供准确 `alt`，压缩后放入 `public/image/blog/<article-group>/`。不要在 MDX 正文里内联实现临时组件或脚本来绕过发布边界。

### 文章快速通道

文章写作与本地预览完成后，提交并推送文章及其专用资源。工作区干净且 `main` 已同步时，发布只需要一个命令：

```powershell
npm run publish:content
```

`publish:content` 从线上当前 release manifest 读取生产代码 revision，并校验该 revision 到当前 HEAD 的全部变更只含普通 Markdown 与文章专用资源；存在其他未上线工程改动时通道直接拒绝，提示改走前端或完整发布，因此在发文前需要让 `main` 保持可随时发布的状态。校验通过后在主工作区直接完成一次静态构建，只上传新旧 `dist/` 之间的变化文件，通过一次 SSH 完成校验、完整版本重建和原子切换；成功后只探测本次文章地址并运行 `Server-infra AfterChange`。发布脚本回归测试保留在开发与 CI，不进入每次文章上线；日常发文无需 API 测试、全站浏览器检查、Nginx 检查或完整前端上传。

`npm run content:release:plan` 只查看范围，不构建、不上线；`npm run content:release:benchmark` 构建并生成差量制品，但不上传。2026-07 实测参考：本地快照、门禁、构建与打包合计约 10 秒，差量包上传约 6 秒，服务器重建与原子切换数秒，`AfterChange` 约 13 秒，端到端约 35 秒；实际时间仍受本机构建和 SSH 网络影响，命令会分别输出各阶段耗时和总耗时。

快速通道只接受：

- `src/content/blog/*.md`
- `public/image/blog/**` 下的 `avif`、`gif`、`jpeg`、`jpg`、`png`、`webp` 图片
- `public/file/blog/**` 下的 `pdf`、`txt`、`csv`、`json`、`zip`、`mp3`、`ogg`、`wav`、`mp4`、`webm` 下载附件

外部链接属于 Markdown 正文，不需要随制品打包；本地链接和图片会在构建后检查目标是否存在。嵌套文章、`.mdx`、原生 HTML、脚本或样式、不在白名单内的附件不属于纯文章；页面、组件、依赖、部署脚本或后端差异不会进入隔离内容构建。需要发布这些工程改动时按 `FastFrontend` 或 `FullAudit` 正常发布；文章或附件删除和“已公开文章改回草稿”也不走日常快速通道。

即使只更新一篇文章，本地也会重新生成完整 `dist/`：首页最新文章、博客列表、标签、RSS 与 Sitemap 都依赖内容集合。上传时只传变化文件，服务器复制上一版本并应用差异，再核对文件数、总字节、入口哈希和整棵文件树哈希。快速通道省掉的是无关验证与传输，不是原子发布和回滚保护。

## UI 与导航

- UI 双语字典：`src/data/i18n.ts`。
- 导航：`src/data/navLinks.ts`。
- 链接与项目数据：`src/data/links.ts`。

新增用户可见文案时同时提供中英文 key，并保留 `data-i18n`、`data-i18n-placeholder` 或 `data-i18n-aria-label` 接线。

## 分级验证

常规开发按改动影响面选择最小充分验证。优先运行对应的 `npm run test:*`、必要的类型检查或构建；浏览器只检查受影响的路由和交互。普通页面视觉调整使用一个代表性视口，涉及响应式布局时再覆盖桌面与移动端。

浏览器与预览规则以 [`AGENTS.md`](../AGENTS.md) 的「开发与验证」节为唯一事实来源；生产发布验收按 `deploy-homepage` Skill 使用用户真实 Chrome。

以下情况使用完整验证入口：用户明确要求软件审查、端到端、全局或完整验证；变更涉及前后端联动、认证、数据库、依赖锁、构建配置或共享基础组件；局部验证失败或影响边界不清楚。纯静态前端发布本身不再自动触发完整验证。

```powershell
npm run verify
```

完整入口覆盖构建、内容配对、品牌资产、Header、Links、UI i18n 和 API 测试。单项失败时再运行对应 `npm run test:*` 命令定位。

完整浏览器矩阵覆盖：

- 首页、`/blog/`、`/tags/`。
- 一篇中文文章和对应英文文章。
- 桌面端与移动端视口。
- 登录、评论、浏览量等受本次修改影响的交互。
- Console、Network 中没有新增错误和资源 404。

## 静态站发布

生产前端是 `xgwnje.cn` 上的 Nginx 静态站。共享服务器路径、权限和 Nginx 配置以本机 `D:\ObjectCode\Server-infra` 为准。

发布分为三档：

- `ContentOnly`：普通 Markdown 文章与白名单格式的文章专用图片、下载附件；运行 `npm run publish:content`，在内容限定门禁下主工作区构建、差量上传并验收本次文章地址。
- `FastFrontend`（默认）：用于影响边界清晰的静态页面和视觉资产。运行 UI 复用约束、类型检查和生产构建，只发布前端，并验收 API health、首页、404 与受影响路由。
- `FullAudit`：用户明确要求软件审查、完整验收、全局或端到端验证，或变更触及后端、认证、数据库、依赖锁、构建配置、部署脚本或基础设施时使用。运行 `npm ci`、后端依赖安装、`npm run verify`、服务与其他项目基线检查及完整浏览器矩阵。

首次把工程、API 或发布脚本一起上线时使用：

```powershell
npm run publish:full
```

它要求干净的 `main` 已与 `origin/main` 一致，并会无跳过地重新执行完整门禁，生成前端与 API 的版本化制品，校验哈希，检查后端运行配置，创建 SQLite 在线 probe 副本和迁移前后完整报告，再原子切换 API 与静态站。API 激活会停服务后创建 SQLite 与 uploads 的一致恢复点；API helper 自身激活失败时才自动恢复。API 一旦本机健康并提交，后续公网、前端或 AfterChange 失败不会自动回退数据库，而是回滚受影响前端并报告需要继续处理的部分发布；不会修改 Nginx。

三个档位都必须生成版本化 release 和可追溯 manifest，校验 SHA-256、文件数量与入口哈希，保留 `current`/`previous` 和 backup，原子切换并提供回滚入口。轻量化只减少与改动无关的验证，不省略制品完整性与回滚保护。

### 服务器端文章发布通道（site-release）

网页后台的地基通道：`server/scripts/site-release.mjs` 在 VPS 专用克隆 `/opt/homepage-site` 上完成"写入或删除文章 → frontmatter 与路径白名单校验 → git commit/push → `astro build` → 文章路由存在性检查 → 版本化目录 + 原子切换 + 公网路由验收"。它只接受 `src/content/blog/*.md` 与 `public/image|file/blog/**` 路径，与本地发布通道共用同一个 flock 和 `releases` 结构，manifest 的 `source` 记为 `web-admin`。

运行环境：`/opt/node22` 是前端构建专用 Node（不改动系统 Node，API 继续用系统版本）；仓库通过仅限本仓库的 GitHub deploy key（`vps-site-release`）读写。首次手动验证（2026-07-19）发布与删除各一次约 24 秒。构建失败在 commit 之前中止，不进入 git 历史；切换后公网验收失败自动恢复备份。当前由管理员在服务器上直接调用；后台页面接入（Phase 1/2）前不面向浏览器开放。

## 本地清理

清理构建缓存、浏览器临时输出和日志，同时保留发布制品记录与 `server-data/`：

```powershell
npm run clean:local
```

确认不再需要本机 `output/` 中的 release 制品时可运行 `npm run clean:local:all`。该命令仍不会删除 `server-data/`、上传数据或仓库外文件。

仅切换静态 release 不需要修改或 reload Nginx。必须修改 Nginx 时，先在 `Server-infra` 核对真实配置、备份目标文件、运行 `nginx -t`，通过后再 reload。

## 前端回滚

1. 将 `current` 切回已经验证的 `previous`。
2. 再次检查首页、博客、标签和静态资源。
3. 记录失败 release，不要覆盖或删除，以便复盘。

前端回滚不应触碰后端 SQLite、上传文件或环境配置。

## SEO

文章发布后确认 Sitemap 包含新 URL；需要主动通知 Bing 时按 [SEO 指南](./seo-guide-zh-CN.md) 执行 IndexNow。站长平台验证值和 IndexNow key 不写入仓库。
