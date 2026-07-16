# HomePage 文档地图

根目录 [README](../README.md) 面向第一次访问项目的人。本目录按职责拆分开发、维护与架构信息，避免同一事实散落在多个入口。

| 文档 | 读者 | 负责内容 |
| --- | --- | --- |
| [架构说明](./architecture.md) | 开发者、维护者 | 系统边界、数据流、长期决策、当前限制 |
| [站点维护](./site-maintenance.zh-CN.md) | 内容与前端维护者 | 发文、本地开发、统一验证、前端发布与回滚 |
| [Journal 文章消费与预览](./human-agency.zh-CN.md) | 内容审核者、前端维护者 | “消化”分类预览、交换包验证、dry-run 导入与碰撞边界 |
| [后端开发](./backend-development.md) | 后端开发者 | 本地环境、配置、API 测试和代码职责 |
| [后端生产维护](./backend-maintenance.zh-CN.md) | 生产维护者 | 版本化发布、SQLite 备份、回滚与健康检查 |
| [SEO 指南](./seo-guide-zh-CN.md) | 内容与站点维护者 | Sitemap、robots、站长平台、IndexNow 与验证 |
| [Agent 规则](../AGENTS.md) | Codex / Agent | 文件边界、安全规则、验证与发布限制 |

## 事实归属

- HomePage 的源码、接口和内容约定归本仓库。
- VPS、DNS、Nginx、systemd、端口和 SNI 等共享服务器事实归本机 `D:\ObjectCode\Server-infra`。
- 密钥、token、服务器登录信息和生产环境值不进入公开文档。

## 更新原则

- 构建、验证、内容工作流变化时更新站点维护文档。
- API 配置或本地调试变化时更新后端开发文档。
- 生产 release、数据备份或回滚变化时更新后端维护文档。
- 服务边界或数据流变化时更新架构说明。
- README 只保留摘要与入口，不复制专题步骤。
