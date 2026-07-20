# HomePage 项目规则

Astro 静态前端 + `server/` Node.js + SQLite 自托管后端。生产前端是 Nginx 静态站。
历史退役方案见 `docs/decisions/legacy-boundaries.zh-CN.md`。

## 铁律（不可违反）

1. 不删除后端保留能力：登录、评论、浏览量、联系表单、设置、管理 API，即使前端入口不完整。
2. 后台页面仅允许有效 Bearer 管理员会话；宣称"后台可用"必须同时通过 API 测试和真实浏览器验收。
3. 不在仓库提交：密钥/token、服务器密码、私有 IP、Nginx/SNI 拓扑、数据库、上传数据、浏览器 profile、构建产物、临时验证截图。
4. `img.xgwnje.cn` 未验证（DNS/存储/迁移/回滚）前，不得批量替换外部图片 URL；上传图床是 `api.xgwnje.cn/uploads`。
5. 基础设施共享事实以 `D:\ObjectCode\Server-infra` 为准，本仓库不复制。
6. 不绕过 `server/scripts/site-release.mjs` 直接改动 VPS 发布克隆 `/opt/homepage-site` 或线上静态目录。
7. SQLite 与上传文件是持久数据，不随 release 替换；备份必须保证 SQLite 一致性。
8. Git：不主动 commit/push/tag/release；提交前查 `git status` 与暂存边界；commit message 中文、UTF-8、LF、无 BOM。

## 关键路径与命令

- 文章：`src/content/blog/`，中英版 `-cn`/`-en` 共享 `group`；文章图片 `public/image/blog/<group>/`，附件 `public/file/blog/<group>/`。
- 视觉资产登记：`src/data/visualAssets.ts`（禁止裸 `/image/sandrone/`、`/image/mascot/` 路径和 `references/visual/` 引用）。
- 依赖安装：`npm ci`、`npm ci --prefix server`。完整验证：`npm run verify`（非常规默认）。
- 视觉检查：`npm run test:ui-reuse`。内容配对检查：`node scripts/run-checks.mjs language-pairs`。

## 最小验证矩阵

| 变更 | 最小验证 |
| --- | --- |
| 普通文章内容 | language-pairs 检查 + 受影响路由预览 |
| 页面/组件/样式 | 相关约定检查 + 一个代表性视口 |
| 响应式 | 同上 + 移动端视口 |
| 脚本/测试/构建配置 | `npm run test:unit` 相关项 + `npm run typecheck` |
| 前后端联动/认证/数据库/依赖锁/基础组件 | `npm run verify` + 全站浏览器矩阵 |

用户要求完整验证、局部失败、或边界无法判断时升级到 `npm run verify`。交付时列明已跑和有意跳过的验证，不得把局部验证说成全局通过。

## 工作规则

- **浏览器**：预览与运行态验证默认用用户真实外部浏览器；临时实例需说明原因并在完成后关闭；给用户看的预览保持打开；不可用时说明原因并请求决定。
- **长任务/子代理**超时、失败、中断后，先汇报状态由用户决定，不自动原样重试。
- **文章英文版**：用户确认普通文章上线后如缺英文稿，默认直接创建忠实英文稿（`group`、日期、分类、标签一致），配对检查后继续上线，不再单独确认。
- **文章布局**：≥2 个章节标题用原生 `##`/`###` 导航；短文自动隐藏目录居中正文；不加 frontmatter 或专用组件。
- **文章效果**：实施前先给简短判断（原生支持？可复用组件？Markdown/图片替代？`ContentOnly` 还是前端发布？）。成本顺序：Markdown → 已有 MDX 组件 → 扩展组件 → 静态图片 → 新组件；一次性效果不得新增组件。新增/修改文章组件即前端改动，不走 `ContentOnly`。
- **资产**：引用 `public/` 前确认存在；删除前 `rg` 查引用；外部迁移图片保留原 URL 直到 CDN 逐篇校验完成。
- **组件复用**：先查 `docs/visual-system/ui-reuse.zh-CN.md`；差状态时扩 Prop/slot 不重画；图标走图标库或集中入口，不散落匿名 `<svg>`；动效复用 `MeteorShower`/`GoldenSpiral`/`ParthenonColumns` 并保持无障碍降级。
- **网页发表通道**：`/admin/editor/` 编辑器（slug 必须 `-cn` 结尾），发表走 `POST /api/admin/article/publish` → 服务器端 site-release；等待界面必须复用 `src/components/admin/PublishProgress.astro`。编辑器预览与 Astro 渲染不逐字一致，交付须声明。详见 `docs/site-maintenance.zh-CN.md`。

## 发布

一律走项目级 `deploy-homepage` Skill（`.agents/skills/deploy-homepage/SKILL.md`）：

- 普通 `.md` 文章 + 专用资源 → `ContentOnly`（`npm run publish:content`）。
- 边界清晰的纯静态前端 → `FastFrontend`；高风险或用户要求完整验收 → `FullAudit`。
- `.mdx`、组件、样式、脚本、配置、基础设施改动不得走 `ContentOnly`。
- 改 Nginx 前先在 `Server-infra` 核对、备份、`nginx -t`；仅替换静态文件不需 reload。

## 文档地图（事实变化时只更新负责该事实的文档）

- `README.md`：定位、入口、快速开始。
- `docs/architecture.md`：架构边界与长期决策。
- `docs/site-maintenance.zh-CN.md`：内容、前端验证、发布与回滚。
- `docs/backend-development.md` / `docs/backend-maintenance.zh-CN.md`：后端开发 / 生产后端。
- `docs/seo-guide-zh-CN.md`：SEO。
- `docs/visual-system/`：组件地图与视觉语法。
