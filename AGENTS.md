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

统一验证入口：

```powershell
npm run verify
```

前端变更还要在真实浏览器验证首页、博客、标签、至少一篇文章和移动端视口。依赖登录态或扩展态时优先使用用户真实 Chrome。

## 内容与资产

- 文章位于 `src/content/blog/`；中英文版本使用 `-cn` / `-en` 文件名并共享 `group`。
- 引用 `public/` 资产前确认文件存在；删除资产前用 `rg` 检查源码、内容和文档引用。
- 不得提交临时验证截图、构建产物、浏览器 profile、数据库、上传数据或真实密钥。README 使用的正式产品截图必须经过选择、压缩并由文档实际引用。
- 文章迁移如带入外部图片，先保留原 URL；只有目标 CDN 已真实可用并完成逐篇校验后才迁移。

## 生产操作

- 不在本仓库复制服务器密码、token、私有 IP 清单或共享 Nginx/SNI 拓扑。
- 生产发布优先使用项目级 [`deploy-homepage` Skill](./.agents/skills/deploy-homepage/SKILL.md)；前端细节见 [站点维护](./docs/site-maintenance.zh-CN.md)，后端使用版本化 `releases/current/previous` 流程，见 [后端维护](./docs/backend-maintenance.zh-CN.md)。
- 修改 Nginx 前先在 `Server-infra` 核对真实配置，备份目标文件并运行 `nginx -t`；仅替换静态文件不需要 reload。
- SQLite 与上传文件属于持久数据，不随代码 release 替换；备份必须保证 SQLite 一致性。

## Git

- 不主动 commit、push、force-push、打 tag 或发 release；只有用户明确要求时才执行。
- 提交前检查 `git status`、分支、远端和暂存边界，不混入其他代理或用户改动。
- commit message 使用中文，文本保持 UTF-8、LF、无 BOM。
