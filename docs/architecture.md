# HomePage 架构说明

## 系统边界

HomePage 由一个静态前端和一个独立 API 组成：

- Astro 在构建期读取 `src/content/blog/`，输出静态文件。
- Nginx 在 `xgwnje.cn` 提供静态页面。
- 浏览器直接请求 `api.xgwnje.cn` 上的 Node.js API。
- API 使用 SQLite 保存结构化数据，并使用独立持久目录保存上传文件。

```mermaid
flowchart TB
  Content["Markdown / MDX"] --> Astro["Astro content build"]
  Astro --> Dist["Static dist"]
  Browser["Browser"] --> Nginx["Nginx"]
  Nginx --> Dist
  Browser --> API["homepage-api"]
  API --> SQLite[("SQLite")]
  API --> Files["Upload storage"]
  API --> GitHub["GitHub OAuth"]
```

共享服务器拓扑不在本仓库重复维护；真实 DNS、端口、Nginx 和 systemd 事实以本机 `D:\ObjectCode\Server-infra` 为准。

## 代码职责

| 位置 | 职责 |
| --- | --- |
| `src/content.config.ts` | 内容 schema |
| `src/content/blog/` | 双语文章源文件 |
| `src/pages/` | Astro 路由 |
| `src/components/` | 页面组件和浏览器交互 |
| `src/layouts/BlogPost.astro` | 文章详情布局 |
| `src/data/` | 导航、链接、i18n 与语录数据 |
| `server/src/app.js` | HTTP 路由和应用逻辑 |
| `server/src/db.js` | SQLite schema、`user_version` 迁移与数据库适配 |
| `server/src/config.js` | 环境变量解析与运行配置 |

## 数据流

### 内容发布

1. 维护者添加一对中英文 Markdown / MDX 文件。
2. 内容 schema 校验 frontmatter。
3. Astro 构建页面、RSS 和 Sitemap。
4. `dist/` 作为不可变静态 release 发布。

### 登录与交互

1. 浏览器通过 GitHub OAuth 或邮箱登录请求 API。
2. API 将 session 保存到 SQLite，并把 session token 返回给前端。
3. 前端使用 Bearer token 请求用户、评论、上传和受保护接口。
4. 浏览量、评论、联系消息、outbox 与上传元数据保存在 SQLite。

## 当前决策

### VPS/Nginx 是唯一生产部署

当前生产前端始终以站点根路径构建并发布到 VPS，服务端配置由 `Server-infra` 管理。构建配置中的兼容目标不构成生产发布流程，也不在运行手册中维护平台专用步骤。

### 数据与代码 release 分离

后端代码使用版本化 release；SQLite、上传文件和运行环境配置独立持久化。切换或回滚代码 release 时不得覆盖数据目录。

### 后台使用当前管理员会话

后台页面与管理 API 使用当前 Bearer session，不依赖 Cloudflare Access 注入头。权限边界必须同时满足：

1. 未登录和非管理员请求被拒绝。
2. 有效管理员可读取统计、评论、联系消息和 outbox，并执行审核操作。
3. API 自动测试与真实浏览器端到端验证都通过后，才可对外宣称后台完整可用。

### 图片 CDN 是条件能力

当前上传文件由 API 的 `/uploads` 路径提供。`img.xgwnje.cn` 不是已完成能力；只有 DNS、存储、迁移清单、缓存策略和回滚全部验证后才能启用。迁移外部文章时，在此之前保留原始图片 URL。

## 上游关系

前端来源是 [Dancncn/DansBlog](https://github.com/Dancncn/DansBlog)。`XGWNJE/DansBlogs_worker` 可用于理解上游 Worker 行为，但不能作为当前生产后端的事实来源。
