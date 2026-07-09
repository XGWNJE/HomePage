# XGWNJE 后端上线与维护说明

本文写给日常维护使用。真实密钥不写入仓库；密钥只保存在服务器环境文件中。

## 当前线上结构

- 前端：`https://xgwnje.cn/`，VPS Nginx 静态目录 `/var/www/xgwnje-home`
- 后端 API：`https://api.xgwnje.cn/`，VPS 上的 `homepage-api.service`
- 后端代码：本仓库 `server/`
- 后端运行目录：`/opt/homepage-api/current`
- 后端数据目录：`/opt/homepage-api/data`
- SQLite 数据库：`/opt/homepage-api/data/homepage-api.sqlite`
- 上传图片目录：`/opt/homepage-api/data/uploads`
- 生产环境变量：`/etc/homepage-api/homepage-api.env`
- 运行依赖：VPS 当前是 Node.js 20；后端优先使用 `node:sqlite`，旧 Node 会自动 fallback 到 `better-sqlite3`
- 构建工具：服务器已安装 `make`/`g++`，用于在 Node 20 上编译 `better-sqlite3`

## 功能状态

- GitHub OAuth 登录：使用 GitHub OAuth App `XGWNJE Homepage`
- 邮箱登录：可生成登录链接；未接入付费邮件服务时，邮件内容写入 outbox，由管理员查看
- 评论：登录后提交；普通文本自动通过，含明显链接/营销词的内容进入待审核
- 浏览量：`/api/views` 和 `/api/views/batch`
- 联系表单：消息写入 SQLite，并同步写入 outbox
- 图片上传：登录后可上传 jpg/png/gif/webp，保存在本机目录并由 `api.xgwnje.cn/uploads/` 访问
- 管理接口：支持 GitHub 管理员账号或 `HOMEPAGE_ADMIN_TOKEN`

## 密钥与环境变量

真实值只在服务器 `/etc/homepage-api/homepage-api.env`，权限应为 `600`。

关键变量：

- `SESSION_SECRET`：会话随机密钥
- `HOMEPAGE_ADMIN_TOKEN`：管理员 API token
- `GITHUB_CLIENT_ID`：GitHub OAuth App Client ID
- `GITHUB_CLIENT_SECRET`：GitHub OAuth App Client Secret
- `ADMIN_GITHUB_LOGINS`：允许进入管理员权限的 GitHub login，例如 `XGWNJE`
- `BASE_URL`：`https://api.xgwnje.cn`
- `FRONTEND_URL`：`https://xgwnje.cn`
- `PUBLIC_ALLOWED_ORIGIN`：允许跨域访问的前端域名
- `DATABASE_PATH`：SQLite 数据库路径
- `UPLOAD_DIR`：图片上传目录
- `UPLOAD_PUBLIC_BASE_URL`：图片公开访问前缀

不要把这些值复制到 README、AGENTS、前端源码、GitHub issue、聊天截图或公开文档中。

## 日常检查

```bash
curl -fsS https://api.xgwnje.cn/health
systemctl status homepage-api --no-pager
journalctl -u homepage-api -n 100 --no-pager
```

查看 Nginx：

```bash
nginx -t
systemctl status nginx --no-pager
tail -n 100 /var/log/nginx/api.xgwnje.cn.error.log
```

## 管理评论与消息

管理员 token 在 `/etc/homepage-api/homepage-api.env` 的 `HOMEPAGE_ADMIN_TOKEN`。使用时只在本机终端或安全环境中读取，不要贴到聊天窗口。

示例：

```bash
ADMIN_TOKEN="$(grep '^HOMEPAGE_ADMIN_TOKEN=' /etc/homepage-api/homepage-api.env | cut -d= -f2-)"
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://api.xgwnje.cn/api/admin/stats
curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://api.xgwnje.cn/api/admin/comments?status=pending"
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"评论ID"}' https://api.xgwnje.cn/api/admin/comment/approve
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://api.xgwnje.cn/api/admin/contact-messages
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://api.xgwnje.cn/api/admin/outbox
```

## 备份

最重要的是数据库和上传目录：

```bash
mkdir -p /root/homepage-backups
cp /opt/homepage-api/data/homepage-api.sqlite /root/homepage-backups/homepage-api.sqlite.$(date +%Y%m%d-%H%M%S)
tar -C /opt/homepage-api/data -czf /root/homepage-backups/uploads.$(date +%Y%m%d-%H%M%S).tar.gz uploads
```

如果 SQLite 处于高写入期，也一起备份 `homepage-api.sqlite-wal` 和 `homepage-api.sqlite-shm`。

## 重启与更新

后端重启：

```bash
systemctl restart homepage-api
journalctl -u homepage-api -n 50 --no-pager
curl -fsS https://api.xgwnje.cn/health
```

更新后端代码：

```bash
cd /opt/homepage-api/current
npm ci --omit=dev
systemctl restart homepage-api
```

修改 Nginx 前必须先备份目标配置，修改后必须运行：

```bash
nginx -t
systemctl reload nginx
```

## 免费替代方案说明

这次没有使用需要额外付费或注册复杂资源的 Cloudflare D1/R2/KV/Workers AI/Resend 组合，而是在 VPS 上用 Node.js + Express + SQLite + 本地文件存储实现同等功能入口。

- D1 替代：本机 SQLite
- R2 替代：`/opt/homepage-api/data/uploads`
- KV/Durable Objects 替代：进程内限流和 SQLite 持久数据
- Workers AI 替代：规则审核 + 管理员人工审核
- Resend 替代：outbox 存储；如以后配置 sendmail，可启用 `ENABLE_SENDMAIL=true`
