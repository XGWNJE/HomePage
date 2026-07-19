# 已退役方案与历史边界

这里归档"不要恢复"类历史决策，避免它们占用 AGENTS.md 的日常规则篇幅。新增退役决策时在对应变更的提交里追加一条。

## 已退役，不得恢复

- 旧 HomePage、旧抽象信号首页、旧 Pages 部署，以及已清理的上游内容资产（本仓库是 `Dancncn/DansBlog` 前端的 XGWNJE 改造版）。
- Cloudflare Access 注入头部的后台鉴权方案；后台只接受有效的 Bearer 管理员会话。
- `XGWNJE/DansBlogs_worker` 作为生产后端；它只是上游 Worker 参考，生产后端是本仓库 `server/`。
- 文章 ContentOnly 快速通道的隔离 worktree overlay 构建（2026-07 起改为"生产 revision..HEAD 只含内容路径"门禁 + 主工作区直接构建，见 `docs/architecture.md`）。
- Codex-Journal 向 `src/content/blog/` 写入选题提纲的集成（2026-07 起该工具与主页解除交互，即使继续使用也只在其自身项目内）。

## 历史文档

`docs/archive/superpowers/` 保存 Codex 维护时期的计划与设计稿，仅作历史参考，不构成当前行为约束。
