# XGWNJE 博客日常维护说明

更新时间：2026-07-10

## 当前线上状态

- 前端站点：`https://xgwnje.cn/`
- API：`https://api.xgwnje.cn/`
- 前端静态目录：`/var/www/xgwnje-home`
- 当前部署备份：`/var/www/xgwnje-home.backup-20260710-025105`
- 后端服务：`homepage-api.service`
- 后端代码：`/opt/homepage-api/current`
- 后端数据：`/opt/homepage-api/data`

## 日常发文章

文章放在 `src/content/blog/`。

中英文文章必须成对维护：

```yaml
---
title: "文章标题"
description: "文章摘要"
pubDate: 2026-07-10
updatedDate: 2026-07-10
lang: "cn"
author: "XGWNJE"
group: "same-article-group"
tags: ["XGWNJE", "Blog"]
important: false
importantOrder: 0
---
```

规则：

- 中文文件建议命名为 `slug-cn.md`。
- 英文文件建议命名为 `slug-en.md`。
- 同一篇文章的中英文版本使用相同 `group`。
- 标签尽量两种语言共用同一组英文/中性标签，避免标签页重复分裂。
- 要置顶到 Important 视图时，设置 `important: true`，并用 `importantOrder` 控制顺序。

当前只有一组示例文章：

- `src/content/blog/hello-xgwnje-index-cn.md`
- `src/content/blog/hello-xgwnje-index-en.md`

新增正式文章后，可以删除或改写这组示例文章。

## 中英 UI 文案

整站 UI 字典在：

- `src/data/i18n.ts`

导航项在：

- `src/data/navLinks.ts`

如果新增按钮、页面标题、弹窗、列表控件，优先给元素加 `data-i18n`、`data-i18n-placeholder` 或 `data-i18n-aria-label`，并在 `src/data/i18n.ts` 同时补中文和英文 key。

文章正文语言不是运行时机器翻译。正文仍按 `-cn.md` / `-en.md` 两份内容维护。

## 本地开发

安装依赖：

```powershell
npm install
```

前端开发：

```powershell
npm run dev -- --host 127.0.0.1
```

本地 API：

```powershell
$env:ALLOWED_ORIGINS='http://127.0.0.1:4321,http://localhost:4321,http://127.0.0.1:4322,http://localhost:4322,https://xgwnje.cn'
npm run api:dev
```

本地预览构建产物：

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4322
```

## 验证命令

日常发布前至少运行：

```powershell
npm run build
npm run test:content
npm run test:i18n
npm run test:api
```

说明：

- `npm run test:content` 检查中英文文章配对。
- `npm run test:i18n` 检查核心 UI 双语入口。
- `npm run test:api` 检查后端核心功能。
- `npm run test:content-reset` 只用于确认本次“清空旧文章后只剩示例文章”的状态。新增正式文章后，应同步更新 `scripts/check-content-reset.mjs` 的 `expectedPosts`，或不再把它作为日常发布门禁。

## 生产部署

部署前：

```powershell
npm run build
```

部署策略：

1. 上传 `dist/` 到服务器的新临时目录，例如 `/var/www/xgwnje-home.next-YYYYMMDD-HHMMSS`。
2. 校验新目录至少包含：
   - `index.html`
   - `blog/hello-xgwnje-index-cn/index.html`
   - `blog/hello-xgwnje-index-en/index.html`
3. 校验文件数量和总字节数。
4. 将旧 `/var/www/xgwnje-home` 移动为 `/var/www/xgwnje-home.backup-YYYYMMDD-HHMMSS`。
5. 将新目录移动为 `/var/www/xgwnje-home`。
6. 静态文件替换不需要 reload Nginx。

发布后检查：

```powershell
Invoke-WebRequest https://xgwnje.cn/ -UseBasicParsing
Invoke-WebRequest https://xgwnje.cn/blog/ -UseBasicParsing
Invoke-WebRequest https://api.xgwnje.cn/health -UseBasicParsing
```

浏览器里至少检查：

- 首页中英 UI 切换。
- `/blog/` 中英文章卡片过滤。
- `/tags/` 标签计数。
- 一篇文章详情页的正文语言切换。
- 登录弹窗能打开，GitHub 登录按钮存在。
- DevTools Console 没有 error/warn/issue。

## 回滚

如果前端上线后发现问题，在服务器上执行：

```bash
mv /var/www/xgwnje-home /var/www/xgwnje-home.bad-$(date +%Y%m%d-%H%M%S)
mv /var/www/xgwnje-home.backup-YYYYMMDD-HHMMSS /var/www/xgwnje-home
```

然后重新访问：

```bash
curl -I https://xgwnje.cn/
```

## 密钥和敏感配置位置

不要把任何密钥写入仓库。

本地服务器连接信息：

- `D:\ObjectCode\Server-infra\server.local.env`

生产 API 环境变量：

- `/etc/homepage-api/homepage-api.env`

生产 API 数据：

- SQLite、上传文件、outbox：`/opt/homepage-api/data`

常见密钥类别：

- SSH 登录信息：只在 `Server-infra` 本地私有资料里。
- GitHub OAuth client id / client secret：生产 API env。
- Session secret / admin token：生产 API env。
- Turnstile site key / secret key：前端公开 site key 和后端 secret 分开管理。

当前项目没有接入付费邮件服务。邮箱登录链接会写入后端 outbox，等邮件基础设施准备好后再启用真实发信。

## 常见维护动作

- 修改 UI 文案：改 `src/data/i18n.ts`。
- 修改导航：改 `src/data/navLinks.ts`。
- 修改友链/项目：改 `src/data/links.ts`。
- 写文章：改 `src/content/blog/`。
- 查后端状态：`systemctl status homepage-api`。
- 查后端日志：`journalctl -u homepage-api -n 100 --no-pager`。
- 查 API 健康：`curl https://api.xgwnje.cn/health`。
