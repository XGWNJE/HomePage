# HomePage 项目规则

本仓库现在是 `Dancncn/DansBlog` 前端的 XGWNJE 替换版。不要恢复旧 HomePage 实现、旧抽象信号首页或旧内容结构。

## 项目边界

- 前端源码在本仓库；生产后端为本仓库 `server/` 下的自托管 Node.js + SQLite API。
- `XGWNJE/DansBlogs_worker` 是 fork 的上游 Worker 参考，不是当前生产后端。
- 保留登录、评论、浏览量、联系表单、设置弹窗、后台页面等完整功能入口；不要为了绕过后端缺失而删除这些功能。
- `api.xgwnje.cn` 指向 VPS 上的 `homepage-api.service`，数据在 `/opt/homepage-api/data`，密钥在 `/etc/homepage-api/homepage-api.env`；不要把这些密钥写进仓库。
- 迁入文章中仍有 `img.danarnoux.com` 图片引用。`img.xgwnje.cn` 尚未解析或接入 R2 前，不要批量替换这些 URL，否则文章图片会 404。

## 开发与验证

```powershell
npm install
npm run dev -- --host 127.0.0.1
npm run build
npm run test:content
npm run test:api
```

变更前端后至少验证：

- `npm run build`
- `npm run test:content`
- `http://127.0.0.1:4321/`
- `http://127.0.0.1:4321/blog/`
- `http://127.0.0.1:4321/tags/`
- 至少一个文章详情页和一个移动端视口截图

## 生产部署

- 生产前端域名：`https://xgwnje.cn/`
- 生产 API 域名：`https://api.xgwnje.cn/`
- VPS/Nginx 静态根目录：`/var/www/xgwnje-home`
- 后端服务：`homepage-api.service`
- 后端代码目录：`/opt/homepage-api/current`
- 后端数据目录：`/opt/homepage-api/data`
- 服务器资料优先查 `D:\ObjectCode\Server-infra`，不要把密码或 token 写进本仓库。
- 部署前端时，先构建 `dist`，上传到新的临时目录，校验 `index.html`、文件数和总字节数，再把旧 `/var/www/xgwnje-home` 移到带时间戳的备份目录并切换新目录。
- 部署后端时，上传 `server/`、安装依赖、写入 `/etc/homepage-api/homepage-api.env`，再 `systemctl restart homepage-api` 并验证 `/health`。
- 只替换静态文件不需要改 Nginx 或 reload；如果要改 Nginx，先备份配置、运行 `nginx -t`，确认变更来源后再 reload/restart。

## Git

- 不主动 commit、push、force-push、打 tag 或发 release；用户明确要求时才执行。
- 提交前检查 `git status`、分支和远端，避免混入无关文件。
- commit message 用中文。
