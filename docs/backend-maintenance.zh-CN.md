# XGWNJE 后端生产维护

本文负责 `homepage-api.service` 的发布、备份、回滚和健康检查。VPS、DNS、Nginx、端口和 systemd 的共享事实以本机 `D:\ObjectCode\Server-infra` 为准。

## 当前服务边界

- 公共 API：`https://api.xgwnje.cn/`。
- 健康检查：`GET /health`。
- 代码来源：本仓库 `server/`。
- 持久数据：SQLite 与上传文件，独立于代码 release。
- 反向代理：Nginx；普通后端代码发布不修改 Nginx。

真实密钥和环境值只由服务器的受限环境配置提供，不写入仓库、命令历史、issue 或聊天记录。

## 版本化目录

后端发布使用稳定指针，不使用不可追溯的临时备份目录：

```text
/opt/homepage-api/
├── releases/
│   └── <git-commit>/       # 一个不可变代码 release
├── current -> releases/... # 当前运行版本
├── previous -> releases/...# 上一个已验证版本
├── data/                   # SQLite 与 uploads，永不随代码切换
└── backups/                # 与 release 对应的一致性备份
```

每个 release 目录放置仓库 `server/` 的内容。systemd 始终从 `current` 启动。

## 发布前检查

在本地：

```powershell
npm ci
npm ci --prefix server
npm run verify
```

在新 release 内、尚未切换 `current` 前：

```bash
npm ci --omit=dev
npm test
```

同时确认：

- release ID 对应明确 Git commit。
- `package-lock.json` 与 release 一起上传。
- 持久数据目录和环境配置没有被打包进 release。
- 目标 Node 版本与依赖兼容。
- `NODE_ENV=production` 且 `DEV_LOGIN=false`；生产环境禁止开放开发登录入口。
- Turnstile 只能成对启用：前端构建的 `PUBLIC_TURNSTILE_SITE_KEY` 必须与后端受限环境的 `TURNSTILE_SITE_KEY` 相同，同时配置对应的 `TURNSTILE_SECRET_KEY`；三者都留空则保持兼容模式。`TURNSTILE_EXPECTED_HOSTNAME` 必须与生产前端主机名一致。
- `SERVICE_VERSION` 与 `SERVICE_REVISION` 能追溯到当前 release；不得放入密钥或用户数据。
- 启用订阅管理时，`SUBSCRIPTION_ACCESS_ENABLED=true`、`SUBSCRIPTION_ACCESS_REGISTRY` 指向受保护的绝对路径，TTL 为 `60..300` 秒，且 GitHub OAuth 配置完整；生产禁止 `SUBSCRIPTION_ACCESS_FIXTURE=true`。

## SQLite 一致性备份

### 在线数据库快照

服务器具备 `sqlite3` CLI 时，使用 SQLite 自身的 `.backup` 创建一致快照，再归档上传目录：

```bash
backup_id="replace-with-release-commit"
backup_dir=/opt/homepage-api/backups/$backup_id
install -d -m 700 "$backup_dir"
sqlite3 /opt/homepage-api/data/homepage-api.sqlite ".backup '$backup_dir/homepage-api.sqlite'"
tar -C /opt/homepage-api/data -czf "$backup_dir/uploads.tar.gz" uploads
```

数据库快照与上传文件需要同一时点一致时，不要在线分别复制；改用停写备份。

### 停写备份

1. 停止 `homepage-api.service`，确认进程退出。
2. 将 SQLite、WAL/SHM 和 uploads 作为一个数据集复制到受限备份目录。
3. 校验备份文件存在且大小合理。
4. 启动服务并验证 `/health`。

不要在服务写入期间只复制主 `.sqlite` 文件，也不要只备份代码 release。

## 切换 release

1. 读取 `current` 的真实目标并让 `previous` 指向它。
2. 让 `current` 指向已安装、已测试的新 release。
3. 重启 `homepage-api.service`。
4. 验证 health、登录、评论读取和上传静态访问。
5. 检查服务日志与 Nginx API 错误日志。

```bash
systemctl restart homepage-api
systemctl status homepage-api --no-pager
journalctl -u homepage-api -n 100 --no-pager
curl -fsS https://api.xgwnje.cn/health
```

`/health` 必须同时返回 `ok: true`、预期的 `version` / `revision`，以及数据库 `readiness.database: "ready"` 和正确的 `schemaVersion`。计划启用验证码时，还必须确认 `readiness.turnstile: "enabled"`；若显示 `disabled`，前端也不得带站点密钥上线。只有 HTTP 200 但 revision、schema 或预期的验证码状态不匹配也视为发布失败。

任何一步失败都应停止扩大变更，不顺带修改 Nginx、DNS 或数据。

## 回滚

代码回滚流程：

1. 确认 `previous` 指向上一个健康 release。
2. 将 `current` 切回 `previous`。
3. 重启服务并重复健康与功能检查。
4. 保留失败 release 和日志用于复盘。

SQLite schema 变化可能让旧代码不兼容。回滚前检查本次 release 是否修改 schema：

- 兼容时只回滚代码。
- 不兼容时停止服务，恢复与该 release 对应的一致性数据库和上传备份，再启动。
- 不允许在不理解 schema 差异时直接覆盖生产数据库。

## 日常检查

```bash
curl -fsS https://api.xgwnje.cn/health
systemctl status homepage-api --no-pager
journalctl -u homepage-api -n 100 --no-pager
```

Nginx 变更不属于普通 API 发布。需要修改时回到 `Server-infra` 核对真实文件，运行 `nginx -t` 后再 reload。

## 管理接口

管理接口接受当前 Bearer session 或受控管理员凭据。仓库文档不提供读取真实 token 的命令，也不把 token 放进示例。日常管理应优先使用经验证的管理员会话；未授权访问必须拒绝，页面是否完整可用以主线程最终浏览器验收为准。

### 订阅管理权限与敏感会话

- `manage_subscriptions` 单独存于 `user_permissions`，不会因普通管理员身份自动获得。
- 只给已经存在且仍被识别为管理员的用户授权；命令不会输出用户资料或订阅值：

```bash
cd /opt/homepage-api/current
npm run permission:manage -- grant --login <existing-admin-login> manage_subscriptions
```

- 撤权使用相同命令的 `revoke` 动作；撤权会同时撤销该用户现有的订阅敏感会话。
- URL 与二维码由 `/var/lib/vps-proxies-subscription/access/` 提供。目录应为 `0750 root:homepage-subscriptions`、文件为 `0640 root:homepage-subscriptions`，`homepage-api` 只通过 systemd `SupplementaryGroups=homepage-subscriptions` 读取。
- 生产解锁必须经过 GitHub 账户选择和身份匹配，签发最长 5 分钟的 host-only、HttpOnly、Secure、SameSite=Strict Cookie。主动锁定、过期、登出、撤权和身份错配都会使秘密接口不可用。
- 审计表只保存用户 ID、动作、结果、时间和 request ID。排查时不得把 URL、二维码、Authorization/Cookie 或原始文件异常复制到日志与工单。

schema v2 新增的权限、短时会话、重新认证挑战和审计表不修改既有业务表。若回滚到只支持 schema v1 的旧代码，必须同时按发布备份恢复数据库，不能只切换 `current`。

### 已知权限维护项

管理员权限目前同时来自 `ADMIN_GITHUB_LOGINS` / `ADMIN_EMAILS` 环境白名单和数据库 `users.is_admin`。GitHub 登录会把当时的白名单结果写入 `is_admin`，而管理接口优先接受该数据库字段，因此只从环境白名单移除账号不一定立即完成撤权，仍需同步清除数据库标记和现有 session。此项暂不处理；后续应统一权限来源，或增加带会话撤销能力的管理员管理界面。
