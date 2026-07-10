---
name: deploy-homepage
description: Safely release the HomePage frontend and self-hosted API to production with versioned artifacts, backups, rollback, route isolation, and live verification. Use when the user explicitly asks to deploy, publish, release, roll back, or verify a production HomePage release.
---

# HomePage 发布

将本仓库发布到 VPS，同时保护 SQLite 数据、共享 Nginx 路由和其他线上项目。开始前完整阅读 [发布契约](./references/release-contract.md)。

## 1. 确认授权与范围

- 只有用户明确要求上线、发布或回滚时才改变生产环境。
- 默认发布前端与 `server/`；若只发布其中一部分，说明另一部分保持不变。
- 不自动 commit、push、tag 或创建 Release。
- 工作区应优先干净。若存在改动，只有用户已明确授权发布当前未提交内容时才继续，并以制品哈希标识发布。
- Nginx 仅在现有配置阻断正确行为时修改，且必须获得针对 Nginx 的明确授权。

## 2. 执行本地门禁

从仓库根目录运行：

```powershell
npm ci
npm ci --prefix server
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/deploy-homepage/scripts/preflight.ps1
```

若用户明确授权脏工作区，最后一条改为添加 `-AllowDirty`。脚本会运行 `npm run verify`，只检查 `D:\ObjectCode\Server-infra\server.local.env` 的必需键，不输出秘密。

## 3. 生成可追踪制品

- 生成 UTC/本地一致的 `release_id`，分别打包 `dist/` 与 `server/`，记录文件数、字节数和 SHA-256；再对包含两者及构建环境摘要的 release manifest 计算 SHA-256。
- 干净工作区使用 Git commit 作为 API revision；已授权脏工作区使用 `worktree-<server-sha12>`，并以 manifest 哈希唯一标识前后端组合，同时在结果中标记未提交。
- 从 `D:\ObjectCode\Server-infra` 读取实时服务器资料；不得依赖旧 IP、旧 SSH 别名或把凭据写进仓库、日志、命令回显。

## 4. 分阶段发布

严格按发布契约执行：先远端预检，再部署后端，确认健康后部署前端。每一步先上传到新路径并验证，再切换 `current`/正式目录；建立 `previous`、数据库、上传目录、环境文件和前端目录备份。任何门禁失败都停止并回滚当前阶段。

## 5. 验收与交付

- 验证 systemd、Nginx 配置、API readiness、数据库 schema、公开路由、404 语义，以及服务器上所有既有项目的基线端点。
- 使用用户真实 Chrome 检查首页、博客、标签、文章、后台入口和移动端视口；检查断图、横向溢出与控制台错误。
- 成功后仅清理已精确确认的本地/远端临时制品，保留版本目录和回滚备份。
- 汇报 release ID、revision、manifest/制品哈希、`current`/`previous`、备份路径、Nginx 变更、验证结果、回滚入口和未解决项。
