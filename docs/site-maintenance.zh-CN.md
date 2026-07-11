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
- 快速发布使用的文章专用图片放在 `public/image/blog/<article-group>/`；共享站点资产继续通过既有资产入口维护。
- 外部图片迁移前先验证目标域名、对象完整性和回滚；不得批量猜测替换。
- 发布前检查构建产物没有草稿文章。

### 文章快速通道

文章写作与本地预览完成后，提交文章及其专用图片。工作区必须干净，先检查发布计划，再推送可恢复的源码并上线：

```powershell
npm run content:release:plan
git push origin main
npm run publish:content
```

`content:release:plan` 从线上当前 release manifest 读取生产 revision，比较它到本地 `HEAD` 的完整差异，运行语言配对、图片预算与生产构建，但不改变线上状态。确认计划后，将该提交推送到 `origin/main`；`publish:content` 会确认本地 `HEAD` 与远端一致，再自动完成制品、哈希、上传、原子切换、定点验收、失败回滚和 `Server-infra AfterChange`。

快速通道只接受：

- `src/content/blog/**`
- `public/image/blog/**`

出现页面、组件、样式、依赖、部署脚本或后端差异时会拒绝。此时先把这些工程变更按 `FastFrontend` 或 `FullAudit` 正常发布，建立新的生产 revision，再单独发布文章。

即使只更新一篇文章，也必须重新生成完整 `dist/`：首页最新文章、博客列表、标签、RSS 与 Sitemap 都依赖内容集合。快速通道省掉的是无关的 API 部署、Nginx 检查、全站浏览器矩阵和后端测试，不是原子发布与回滚保护。

## UI 与导航

- UI 双语字典：`src/data/i18n.ts`。
- 导航：`src/data/navLinks.ts`。
- 链接与项目数据：`src/data/links.ts`。

新增用户可见文案时同时提供中英文 key，并保留 `data-i18n`、`data-i18n-placeholder` 或 `data-i18n-aria-label` 接线。

## 分级验证

常规开发按改动影响面选择最小充分验证。优先运行对应的 `npm run test:*`、必要的类型检查或构建；浏览器只检查受影响的路由和交互。普通页面视觉调整使用一个代表性视口，涉及响应式布局时再覆盖桌面与移动端。

前端日常预览默认使用 Codex 内置浏览器。调试载体按问题选择：普通布局、交互、Console 与资源问题优先使用内置浏览器；依赖真实登录态、用户 profile、扩展状态或 Chrome 特有行为时使用用户真实 Chrome；需要隔离复现或自动化诊断时可使用临时浏览器或终端工具，并说明原因。生产发布验收仍按 `deploy-homepage` Skill 使用真实 Chrome。

如果预览是交给用户查看的结果，应显示并保留内置浏览器标签和对应本地预览服务，不在自动检查完成后立即关闭。仅在用户明确表示看完、要求关闭，或新任务明确替代该预览时清理；纯后台诊断标签可以按需关闭。

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

- `ContentOnly`：仅文章与文章专用图片；运行 `npm run publish:content`，自动判定范围并验收所有受影响内容路由。
- `FastFrontend`（默认）：用于影响边界清晰的静态页面和视觉资产。运行 UI 复用约束、类型检查和生产构建，只发布前端，并验收 API health、首页、404 与受影响路由。
- `FullAudit`：用户明确要求软件审查、完整验收、全局或端到端验证，或变更触及后端、认证、数据库、依赖锁、构建配置、部署脚本或基础设施时使用。运行 `npm ci`、后端依赖安装、`npm run verify`、服务与其他项目基线检查及完整浏览器矩阵。

首次把工程、API 或发布脚本一起上线时使用：

```powershell
npm run publish:full
```

它要求干净的 `main` 已与 `origin/main` 一致，并会重新执行完整门禁，生成前端与 API 的版本化制品，校验哈希，创建 SQLite 在线备份和 migration probe，再原子切换 API 与静态站。任一线上验收失败时会恢复本次已切换的部分；不会修改 Nginx。

三个档位都必须生成版本化 release 和可追溯 manifest，校验 SHA-256、文件数量与入口哈希，保留 `current`/`previous` 和 backup，原子切换并提供回滚入口。轻量化只减少与改动无关的验证，不省略制品完整性与回滚保护。

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
