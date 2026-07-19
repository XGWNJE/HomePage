# HomePage 项目规则

本仓库是 `Dancncn/DansBlog` 前端的 XGWNJE 改造版。当前主要维护 agent 是 Kimi CLI。已退役方案与"不要恢复"类历史决策归档在 [`docs/decisions/legacy-boundaries.zh-CN.md`](./docs/decisions/legacy-boundaries.zh-CN.md)。

## 项目边界

- 前端源码、内容和自托管后端都在本仓库；生产前端是 Nginx 静态站，生产后端是 `server/` 下的 Node.js + SQLite API。
- `XGWNJE/DansBlogs_worker` 只是上游 Worker 参考，不是生产后端。
- 登录、评论、浏览量、联系表单、设置和管理 API 是保留能力，不得因前端入口不完整而删除后端接口。
- 后台页面只允许在有效的 Bearer 管理员会话下使用，未登录或非管理员必须被拒绝。只有 API 测试与主线程真实浏览器验收都通过后才能宣称后台完整可用。
- 当前上传图片由 `api.xgwnje.cn/uploads` 提供。`img.xgwnje.cn` 只有在 DNS、存储、迁移清单和回滚方案全部验证后才能启用；此前不得批量替换外部图片 URL。
- VPS、DNS、Nginx、systemd、端口与 SNI 的共享事实以本机 `D:\ObjectCode\Server-infra` 为准。本仓库只记录 HomePage 自身的接口和维护边界。

## 文档职责

- `README.md`：产品定位、真实入口、快速开始、能力和文档地图。
- [`docs/architecture.md`](./docs/architecture.md)：架构边界与长期决策。
- [`docs/site-maintenance.zh-CN.md`](./docs/site-maintenance.zh-CN.md)：内容、前端验证、发布与回滚。
- [`docs/backend-development.md`](./docs/backend-development.md)：本地后端开发。
- [`docs/backend-maintenance.zh-CN.md`](./docs/backend-maintenance.zh-CN.md)：生产后端发布、备份与回滚。
- [`docs/seo-guide-zh-CN.md`](./docs/seo-guide-zh-CN.md)：SEO 配置和验证。

入口、命令、目录、环境变量或部署边界变化时，只更新负责该事实的文档；其他位置保留摘要和链接。

## 开发与验证

依赖安装使用可复现方式：`npm ci`、`npm ci --prefix server`。完整验证入口是 `npm run verify`，它不是每次常规改动的默认动作。

按变更面选择最小充分验证：

| 变更 | 最小验证 |
| --- | --- |
| 普通文章内容（`.md` 及专用图片/附件） | `node scripts/run-checks.mjs language-pairs` + 受影响路由预览 |
| 页面、组件、样式 | 相关约定检查（`node scripts/run-checks.mjs <名称>`）+ 受影响路由一个代表性视口 |
| 响应式布局 | 同上，另加移动端视口 |
| 脚本、测试、构建配置 | `npm run test:unit` 中相关测试 + `npm run typecheck` |
| 前后端联动、认证、数据库、依赖锁、共享基础组件 | `npm run verify` + 全站浏览器矩阵 |

用户明确要求软件审查、端到端、全局或完整验证，局部验证失败，或影响边界无法可靠判断时，同样升级到 `npm run verify`。纯静态前端发布本身不自动触发完整验证。交付时明确列出已运行和有意跳过的验证，不得把局部验证表述为全局通过。

浏览器规则（唯一事实来源，其他文档引用本节）：日常预览与运行态验证默认使用用户真实的外部浏览器，Kimi CLI 下即 chrome-devtools MCP 连接的 Chrome。需要临时或隔离浏览器实例时说明原因，完成后关闭实例及对应本地预览服务；交给用户查看的预览保持打开，直到用户表示看完、要求关闭或被新任务替代。外部浏览器不可用或不适合时，说明原因并请求用户决定。生产发布的浏览器验收遵循 `deploy-homepage` Skill。

长任务或子代理超时、失败、被中断后，先汇报当前状态由用户决定下一步，不自动原样重试。

## 内容与资产

- 文章位于 `src/content/blog/`；中英文版本使用 `-cn` / `-en` 文件名并共享 `group`。文章专用本地图片放在 `public/image/blog/<article-group>/`，下载附件放在 `public/file/blog/<article-group>/`，以便内容快速发布通道可靠判定范围。
- 用户确认普通文章上线后，如果缺少对应英文版，默认创建忠实英文稿并保持 `group`、发布日期、分类、标签和事实边界一致；完成中英文配对检查后继续上线，不再为补英文稿单独请求确认。
- 选题进入可审核稿时按文章结构选择布局：至少两个可识别的章节标题时使用原生 `##` / `###` 形成导航；标题应是自然过渡句，不为凑目录制造空章节。零个或一个标题的短文、连续叙事由文章页自动隐藏目录并让正文居中。该选择不增加 frontmatter 或专用组件。
- 用户提出文章中的图表、卡片、时间线、特殊排版或交互效果时，实施前先给出简短判断：当前是否原生支持、是否已有可复用组件、能否用 Markdown 基础样式或静态图片替代、是否必须新增/修改组件，以及对应是 `ContentOnly` 还是前端发布。
- 文章效果默认按“Markdown 基础能力 → 已有 MDX 组件 → 扩展已有组件 → 静态图片 → 新组件”的成本顺序评估；一次性、内容固定且不需要交互的数据图或示意图可以优先图片，重复使用、需要数据更新、响应式、主题适配、多语言或可访问语义时优先组件。不得为了展示一个一次性效果直接新增组件。
- 推荐静态图片时同时提供文字结论或数据表、准确 `alt`，并把压缩后的资产放入 `public/image/blog/<article-group>/`；图片不能成为重要信息的唯一载体。新增或修改文章组件属于前端改动，即使只被一篇 MDX 引用也不能走 `ContentOnly`。
- 引用 `public/` 资产前确认文件存在；删除资产前用 `rg` 检查源码、内容和文档引用。
- 不得提交临时验证截图、构建产物、浏览器 profile、数据库、上传数据或真实密钥。README 使用的正式产品截图必须经过选择、压缩并由文档实际引用。
- 文章迁移如带入外部图片，先保留原 URL；只有目标 CDN 已真实可用并完成逐篇校验后才迁移。

## 组件与视觉复用

- 开发前先查 [`docs/visual-system/ui-reuse.zh-CN.md`](./docs/visual-system/ui-reuse.zh-CN.md) 的组件地图；现有组件只差状态时先扩展 Prop 或 slot，不复制外观重画。
- 桑多涅、站长形象和包装备用资产统一登记在 `src/data/visualAssets.ts`；页面和组件不得新增裸 `/image/sandrone/`、`/image/mascot/` 路径，也不得引用研究目录 `references/visual/sandrone/`。
- 新增 UI 图标必须走成熟图标库或集中图标入口；现有品牌装饰 SVG 只在具名组件内维护。不得在新页面散落匿名 `<svg>`/`<path>`。
- 背景和动效优先复用 `MeteorShower`、`GoldenSpiral`、`ParthenonColumns` 及现有进入动效，并保持 `aria-hidden`、`pointer-events: none`、z-index 和 reduced-motion 降级。
- 运行 `npm run test:ui-reuse` 检查视觉资产存在性、字符资产入口和新增内联 SVG；详细视觉语法见 [`docs/visual-system/sandrone-visual-language.zh-CN.md`](./docs/visual-system/sandrone-visual-language.zh-CN.md)。

## 生产操作

- 不在本仓库复制服务器密码、token、私有 IP 清单或共享 Nginx/SNI 拓扑。
- 生产发布优先使用项目级 [`deploy-homepage` Skill](./.agents/skills/deploy-homepage/SKILL.md)；前端细节见 [站点维护](./docs/site-maintenance.zh-CN.md)，后端使用版本化 `releases/current/previous` 流程，见 [后端维护](./docs/backend-maintenance.zh-CN.md)。
- 影响边界清晰的纯静态前端发布默认使用 `FastFrontend`；用户明确要求软件审查/完整验收，或变更触及高风险边界时使用 `FullAudit`。两档都保留版本化制品、哈希、备份、原子切换、回滚和 `Server-infra AfterChange`。
- 普通 `.md` 文章及其 `public/image/blog/` 图片、`public/file/blog/` 安全附件使用 `npm run publish:content` 的 `ContentOnly` 通道。快速通道校验自生产 release 以来的全部变更只含文章内容与文章专用资源，然后在主工作区直接构建并差量上传；仓库中存在其他未上线代码时通道会拒绝发布并提示走前端或完整发布。`.mdx`、组件、样式、脚本、配置或基础设施改动仍按普通前端或完整发布处理。
- 修改 Nginx 前先在 `Server-infra` 核对真实配置，备份目标文件并运行 `nginx -t`；仅替换静态文件不需要 reload。
- VPS 上存在服务器端文章发布地基：`/opt/homepage-site` 是专用发布克隆（归 `homepage-api` 持有，deploy key 仅限本仓库读写），`/opt/node22` 是前端构建用的独立 Node 22，`server/scripts/site-release.mjs` 在其上完成"写入文章 → 构建 → 版本化原子切换"。它与本地发布通道共用 flock 和 releases 结构，不得绕过脚本直接改动该克隆或线上静态目录。API（`homepage-api` 用户，隶属 `www-data` 组）直接执行发布与同步，`/var/www` 走属组授权，无 sudo 路径。
- 网页发表通道：后台 `/admin/editor/` 提供文章编辑器（草稿存 SQLite `article_drafts` 表，30 秒自动保存，右侧为 marked 近似预览）；发表走 `POST /api/admin/article/publish` → 服务器端 site-release 构建上线，成功后删除草稿，失败保留草稿。编辑器以中文稿为主（slug 必须 `-cn` 结尾）；填写英文正文后发表时自动生成同 `group`、同 `pubDate` 的 `-en` 配对稿（英文标题/描述留空回退中文）。正文引用的 `/uploads/` 图片会在发表时复制为 `public/image/blog/<group>/` 文章专属资产并改写 URL。修订已发布 md 文章：`/admin` 列表「编辑」把文章载入编辑器，覆盖发表保留原 `pubDate` 并追加 `updatedDate`；MDX 文章不允许网页覆盖。预览渲染与 Astro 内容管线不逐字一致，交付时须声明。
- SQLite 与上传文件属于持久数据，不随代码 release 替换；备份必须保证 SQLite 一致性。

## Git

- 不主动 commit、push、force-push、打 tag 或发 release；只有用户明确要求时才执行。
- 提交前检查 `git status`、分支、远端和暂存边界，不混入其他代理或用户改动。
- commit message 使用中文，文本保持 UTF-8、LF、无 BOM。
