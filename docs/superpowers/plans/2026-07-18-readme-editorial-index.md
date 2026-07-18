# README Editorial Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把仓库 README 重构为项目原生的编辑部式索引首页，并用当前生产站截图替换过时素材。

**Architecture:** README 保留为标准 GitHub Flavored Markdown，用一个纯 SVG 负责身份和机制概览，用两张真实 WebP 截图提供产品证据。技术细节继续链接到现有维护文档，避免在 README 重复维护发布事实。

**Tech Stack:** GitHub Flavored Markdown、SVG 1.1、安全 HTML 子集、Playwright 浏览器截图、Sharp WebP 编码、Python README 审计脚本。

## Global Constraints

- 只修改 `README.md`、`assets/readme/`、本设计规格与本计划。
- 不修改站点前端、后端、内容模型、部署配置或生产环境。
- 不增加运行时依赖。
- SVG 不使用脚本、远程字体或 `foreignObject`。
- 截图只做裁切、缩放与 WebP 压缩，不修改产品内容。
- 文本保持 UTF-8、LF、无 BOM、无 Unicode 替换字符。
- 未经明确授权不提交、不推送、不创建 PR、不发布；因此本计划不含 commit 步骤。

---

### Task 1: 重制当前产品证据

**Files:**
- Create: `assets/readme/home-desktop.webp`
- Create: `assets/readme/article-mobile.webp`
- Delete after reference check: `docs/assets/home-desktop.webp`
- Delete after reference check: `docs/assets/article-mobile.webp`

**Interfaces:**
- Consumes: `https://xgwnje.cn/` 与 `https://xgwnje.cn/blog/ai-bug-report-achievement-cn/` 当前生产页面。
- Produces: README 可直接引用的桌面端与移动端 WebP 文件。

- [x] **Step 1: 建立专用素材目录并确认旧引用**

Run:

```powershell
New-Item -ItemType Directory -Force assets/readme | Out-Null
rg -n "docs/assets/(home-desktop|article-mobile)\.webp|assets/readme/(home-desktop|article-mobile)\.webp" .
```

Expected: 旧文件仅被当前 `README.md` 引用，新文件尚未被引用。

- [x] **Step 2: 捕获当前桌面主页**

使用浏览器将视口设为 `1440x900`，打开 `https://xgwnje.cn/`，等待页面主内容和图片稳定后捕获当前视口到临时 PNG。截图必须显示站点名称、主要入口和至少一块真实内容区域，不包含浏览器 UI。

- [x] **Step 3: 捕获当前移动端文章**

将同一浏览器视口设为 `390x844`，打开 `https://xgwnje.cn/blog/ai-bug-report-achievement-cn/`，等待标题和正文稳定后捕获当前视口到临时 PNG。截图必须显示文章标题、正文布局及移动端导航状态。

- [x] **Step 4: 编码为 WebP 并检查文件**

使用仓库现有 `sharp` 对截图按 `quality: 82` 编码为对应 WebP；不添加文字、边框或合成元素。

Run:

```powershell
node -e "const s=require('sharp'); Promise.all([s('assets/readme/home-desktop.png').webp({quality:82}).toFile('assets/readme/home-desktop.webp'),s('assets/readme/article-mobile.png').webp({quality:82}).toFile('assets/readme/article-mobile.webp')]).catch(e=>{console.error(e);process.exit(1)})"
```

Expected: 两个 `.webp` 可由 Sharp 读取，尺寸分别接近 `1440x900` 与 `390x844`，临时 PNG 在检查后删除。

### Task 2: 制作项目原生 SVG 主视觉

**Files:**
- Create: `assets/readme/hero.svg`

**Interfaces:**
- Consumes: 设计规格中的色彩、字体、索引流程和 GitHub 安全约束。
- Produces: README 首屏使用的 `1200x420` 自包含 SVG。

- [x] **Step 1: 写入完整 SVG**

SVG 必须包含：

- `<title>XGWNJE personal index</title>` 与描述项目机制的 `<desc>`。
- `viewBox="0 0 1200 420"` 和近黑色完整背景。
- 左侧 `XGWNJE / PERSONAL INDEX`、中文价值句及 `RESEARCH · ENGINEERING · LONG-TERM NOTES`。
- 右侧 `NOTE / CODE / IMAGE → ASTRO INDEX → WEB / RSS / API` 流程。
- `STATIC FRONTEND`、`SELF-HOSTED API`、`BILINGUAL CONTENT` 三项事实标签。
- 暖金、玫红和暖白的高对比文本；系统衬线、无衬线和等宽字体栈。

- [x] **Step 2: 做结构与安全检查**

Run:

```powershell
python -c "import xml.etree.ElementTree as ET; ET.parse(r'assets/readme/hero.svg'); print('SVG OK')"
rg -n "foreignObject|<script|@import|https?://" assets/readme/hero.svg
```

Expected: XML 解析输出 `SVG OK`，安全模式搜索无结果。

- [x] **Step 3: 渲染并目视检查**

使用 Sharp 把 SVG 渲染为临时 PNG，在 `1200px` 宽和约 `600px` 窄两种显示宽度检查：身份、价值句、流程和三个事实标签均可读，背景边界完整，无裁切和文字重叠；检查后删除临时 PNG。

### Task 3: 重构 README 叙事与版面

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `assets/readme/hero.svg`、两张生产截图、现有站点链接和维护文档。
- Produces: 首屏清晰、证据优先、可在 GitHub 直接阅读的仓库首页。

- [x] **Step 1: 重写首屏**

按以下顺序写入：

```markdown
<p align="center"><img src="./assets/readme/hero.svg" alt="XGWNJE：研究、工程与长期笔记汇入个人索引，并发布到 Web、RSS 与 API" width="100%"></p>

<p align="center">
  <a href="https://xgwnje.cn/">在线主页</a> ·
  <a href="https://xgwnje.cn/blog/">文章归档</a> ·
  <a href="https://xgwnje.cn/tags/">主题索引</a> ·
  <a href="https://api.xgwnje.cn/health">API 状态</a>
</p>

<p align="center"><img src="./assets/readme/home-desktop.webp" alt="XGWNJE 当前生产主页的桌面端界面" width="100%"></p>
```

主图之后用一段不超过三句的中文解释项目：它是个人索引，不是通用博客模板；它把中英内容、静态站点与自托管服务维护在同一仓库。

- [x] **Step 2: 写入价值、快速开始与文章发布路径**

使用三个短条目说明：长期内容索引、Astro 静态前端、自托管交互服务。快速开始只保留：

```powershell
npm ci
npm run dev
```

普通 Markdown 文章发布保留：

```powershell
npm run publish:content
```

并链接 `docs/site-maintenance.zh-CN.md`，不在 README 重复部署和回滚细节。

- [x] **Step 3: 保留并收紧架构、边界和仓库地图**

保留现有 Mermaid 的浏览器 → Nginx → 静态前端 / Node API / SQLite 拓扑，删除重复段落。用一张表表达 `src/`、`src/content/blog/`、`server/`、`docs/` 的职责，并保留架构、前端维护、后端开发、后端生产、SEO 五个真实文档入口。

- [x] **Step 4: 加入移动端证据与来源说明**

在架构之后以居中图片加入 `assets/readme/article-mobile.webp`，宽度限制为 `360`，alt 明确为“当前生产文章页的移动端阅读布局”。末尾保留 `Dancncn/DansBlog` 上游说明和 `MIT` 许可证。

### Task 4: 清理、审计与交付检查

**Files:**
- Delete: `docs/assets/home-desktop.webp`
- Delete: `docs/assets/article-mobile.webp`
- Verify: `README.md`
- Verify: `assets/readme/hero.svg`
- Verify: `assets/readme/home-desktop.webp`
- Verify: `assets/readme/article-mobile.webp`

**Interfaces:**
- Consumes: Tasks 1-3 的最终文件。
- Produces: 无断链、无过时截图、通过局部审计的 README 改造。

- [x] **Step 1: 确认新引用并删除旧素材**

Run:

```powershell
rg -n "docs/assets/(home-desktop|article-mobile)\.webp" .
rg -n "assets/readme/(hero\.svg|home-desktop\.webp|article-mobile\.webp)" README.md
```

Expected: 第一条无结果；第二条列出三个新素材。随后删除两个已被 Git 跟踪、可从版本历史恢复的旧 WebP。

- [x] **Step 2: 运行 README 专项审计**

Run:

```powershell
python C:\Users\Administrator\.codex\skills\beautify-github-readme\scripts\audit_readme.py README.md
```

Expected: 审计通过，或只报告不影响 GitHub 可读性的明确非阻塞建议。

- [x] **Step 3: 验证素材、编码和差异**

Run:

```powershell
node -e "const s=require('sharp'); Promise.all(['assets/readme/home-desktop.webp','assets/readme/article-mobile.webp'].map(async f=>console.log(f,await s(f).metadata()))).catch(e=>{console.error(e);process.exit(1)})"
python -c "from pathlib import Path; files=[Path('README.md'),Path('assets/readme/hero.svg')]; assert all(not p.read_bytes().startswith(b'\xef\xbb\xbf') for p in files); assert all('\ufffd' not in p.read_text(encoding='utf-8') for p in files); print('UTF-8 OK')"
git diff --check
git status --short
```

Expected: 两张图片均为有效 WebP；文本输出 `UTF-8 OK`；`git diff --check` 无输出；Git 状态仅包含 README、三个新素材、两份本轮文档及两个旧素材删除。

- [x] **Step 4: 最终视觉核对**

检查 README 的宽屏和窄屏预览，确认首屏顺序为“主视觉 → 入口 → 当前主页”，移动端截图未撑破布局，命令可复制，所有链接和图片都有独立可理解的文本或 alt。交付时明确列出有意跳过的全站构建、完整浏览器矩阵、提交、推送和发布。
