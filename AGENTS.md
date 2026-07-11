# HomePage 项目规则

本仓库是 `Dancncn/DansBlog` 前端的 XGWNJE 改造版。不要恢复旧 HomePage、旧抽象信号首页、旧 Pages 部署或已清理的上游内容资产。

## 项目边界

- 前端源码、内容和自托管后端都在本仓库；生产前端是 Nginx 静态站，生产后端是 `server/` 下的 Node.js + SQLite API。
- `XGWNJE/DansBlogs_worker` 只是上游 Worker 参考，不是生产后端。
- 登录、评论、浏览量、联系表单、设置和管理 API 是保留能力，不得因前端入口不完整而删除后端接口。
- 后台页面只允许在有效的 Bearer 管理员会话下使用，未登录或非管理员必须被拒绝；不得恢复 Cloudflare Access 旧头部方案。只有 API 测试与主线程真实浏览器验收都通过后才能宣称后台完整可用。
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

依赖安装使用可复现方式：

```powershell
npm ci
npm ci --prefix server
```

`npm run verify` 是完整验证入口，不是每次常规改动的默认动作：

```powershell
npm run verify
```

常规开发默认按影响面选择最小充分验证：只运行与变更直接相关的测试、类型检查、构建或页面检查；前端只验收受影响路由和交互，普通视觉改动使用一个代表性视口，涉及响应式布局时再覆盖桌面与移动端。

前端日常预览默认使用 Codex 内置浏览器。调试时按问题选择合适载体：普通布局、交互、Console 和资源问题优先在内置浏览器定位；依赖真实登录态、用户 profile、扩展状态或 Chrome 特有行为时使用用户真实 Chrome；需要隔离复现或自动化诊断时可使用临时浏览器或终端工具，并说明选择原因。生产发布的浏览器验收仍遵循 `deploy-homepage` Skill。

当内置浏览器预览是交给用户查看的结果时，应显示并保留预览标签，同时保持对应本地预览服务运行；不得在自动检查结束后立即关闭。只有用户明确表示看完、要求关闭，或新任务明确取代该预览时才清理。纯后台自动化诊断产生的临时标签不受此限制。

以下情况升级为 `npm run verify` 和全站浏览器矩阵：用户明确要求软件审查、端到端、全局或完整验证；变更跨越前后端、认证、数据库、依赖锁、构建配置或共享基础组件；相关验证失败，或影响边界无法可靠判断。纯静态前端发布本身不再自动触发完整验证。交付时明确列出已运行和有意跳过的验证，不得把局部验证表述为全局通过。

## 内容与资产

- 文章位于 `src/content/blog/`；中英文版本使用 `-cn` / `-en` 文件名并共享 `group`。文章专用本地图片放在 `public/image/blog/`，以便内容快速发布通道可靠判定范围。
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
- 仅文章与 `public/image/blog/` 图片变更使用 `npm run publish:content` 的 `ContentOnly` 通道；它必须从线上 manifest revision 自动判定范围，夹带任何代码、配置或基础设施改动时拒绝并升级普通发布。
- 修改 Nginx 前先在 `Server-infra` 核对真实配置，备份目标文件并运行 `nginx -t`；仅替换静态文件不需要 reload。
- SQLite 与上传文件属于持久数据，不随代码 release 替换；备份必须保证 SQLite 一致性。

## Git

- 不主动 commit、push、force-push、打 tag 或发 release；只有用户明确要求时才执行。
- 提交前检查 `git status`、分支、远端和暂存边界，不混入其他代理或用户改动。
- commit message 使用中文，文本保持 UTF-8、LF、无 BOM。
