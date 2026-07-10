# HomePage 后端开发

本文只负责本地 API 开发。生产发布、数据备份和回滚见 [后端生产维护](./backend-maintenance.zh-CN.md)。完整仓库验证使用 Node.js 22.12–24、npm 10–11；独立 API 服务仍可在当前生产 Node.js 20 环境运行。

## 运行方式

从仓库根目录安装锁定依赖：

```powershell
npm ci
npm ci --prefix server
```

启动前端：

```powershell
npm run dev -- --host 127.0.0.1
```

另开一个 PowerShell，使用仅供本地开发的配置启动 API：

```powershell
$env:NODE_ENV = 'development'
$env:PUBLIC_ALLOWED_ORIGIN = 'http://127.0.0.1:4321,http://localhost:4321'
$env:DEV_LOGIN = 'true'
npm run api:dev
```

上述两个本地前端来源已包含在开发环境默认值中；只有使用其他端口或主机名时才需要显式设置 `PUBLIC_ALLOWED_ORIGIN`。

API 默认监听 `http://127.0.0.1:8787`，本地数据写入已忽略的 `server-data/`。不要把生产环境变量复制到本地仓库。

## 配置边界

`server/src/config.js` 负责解析运行配置。开发中常用的变量：

| 变量 | 用途 |
| --- | --- |
| `HOST` / `PORT` | API 监听地址与端口 |
| `PUBLIC_ALLOWED_ORIGIN` | 允许访问 API 的本地前端来源 |
| `HOMEPAGE_API_DATA_DIR` | 本地数据目录 |
| `DATABASE_PATH` | SQLite 文件位置 |
| `DEV_LOGIN` | 仅在显式设为 `true` 时启用本地测试登录；生产环境禁止启用 |
| `BASE_URL` / `FRONTEND_URL` | OAuth 和返回地址 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 成对启用邮件登录与联系表单的服务端人机验证；站点密钥必须与前端 `PUBLIC_TURNSTILE_SITE_KEY` 相同 |
| `TURNSTILE_EXPECTED_HOSTNAME` | 允许签发 Turnstile token 的站点主机名，默认取 `FRONTEND_URL` |
| `SERVICE_VERSION` / `SERVICE_REVISION` | 暴露在 `/health` 的可追溯 release 元数据 |

GitHub OAuth、管理员 token、session secret 等生产值只由部署环境提供。示例配置文件可以提交，但必须以 `.example` 结尾且只含占位值。

前端公开变量参考根目录 `.env.example`。其中所有 `PUBLIC_*` 值都会进入浏览器构建，禁止放入 Turnstile secret、OAuth secret、管理员 token 或 session secret。Turnstile 的前端站点密钥和后端站点密钥必须使用同一个值，并与后端 secret 成对配置；全部留空时为本地兼容模式。

## 代码地图

| 文件 | 职责 |
| --- | --- |
| `server/src/server.js` | 进程入口与优雅退出 |
| `server/src/config.js` | 配置加载 |
| `server/src/db.js` | schema、SQLite 初始化和驱动选择 |
| `server/src/app.js` | 路由、认证、评论、上传和管理逻辑 |
| `server/test/api.test.js` | API 集成测试 |

数据库层会优先使用当前 Node 提供的 `node:sqlite`，不可用时回退到 `better-sqlite3`。schema 变更按 `PRAGMA user_version` 顺序迁移；每次变更都要新增版本并测试新库、旧库升级和重复启动。生产 Node 版本与本地版本不一致时，要明确验证生产实际使用的驱动。

## 验证

后端快速验证：

```powershell
npm run test:api
```

提交前统一验证：

```powershell
npm run verify
```

手动联调至少覆盖：

1. `GET /health`。
2. 本地登录后调用 `GET /api/me`。
3. 浏览量读取与写入。
4. 评论匿名拒绝和登录提交。
5. 非图片上传拒绝。
6. 非管理员访问管理接口被拒绝。

## 数据与清理

- `server-data/`、SQLite、WAL/SHM 和上传文件都属于本地运行数据，不提交。
- 测试使用临时数据库，不得指向生产数据。
- 修改 schema 时同时考虑新库初始化、现有库升级和旧代码回滚兼容性。
- 删除本地数据前确认没有需要保留的调试样本；生产数据操作不属于本地开发流程。
