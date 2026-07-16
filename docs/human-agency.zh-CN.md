# Journal 文章消费与预览

HomePage 是公开展示层，不是私有加工台。它只消费版本、批准状态和哈希全部通过的公开安全交换包；原始观察、claim、证据工作区和审核事件始终留在 Codex-Journal。

这些内容不再拥有独立板块。通过验证后，它们会成为普通博客文章，使用现有博客卡片和正文布局，并统一标记为 `category: 消化` 与 `tag: 消化`。存在公开文章时，读者可在 `/blog/digested/` 筛选，也可在普通博客列表、归档、RSS 和相关文章中看到它们；没有正式公开文章时，“消化”入口自动隐藏。

## 正式内容

正式来源记录位于 `src/content/human-agency/*.json`。文件保存稳定发布时间和公开 entry；组合 blog loader 将它们与 `src/content/blog/` 的 Markdown/MDX 一起写入同一个 blog collection。

普通构建不读取仓库外路径，也不会因为本机存在 Journal 工作区就自动加入私有预览内容。

## 本地真实页面预览

先在 Codex-Journal 中由人批准到 `approved-preview` 并导出预览包，再运行：

```powershell
npm run journal:preview -- --package <absolute-preview-package-path>
```

命令会先独立验证 Schema、批准状态、entry hash 和 package hash，然后只为这一次 Astro 进程设置 `JOURNAL_PREVIEW_PACKAGE`。预览文章进入真实 `/blog/digested/` 和 `/blog/<slug>/`，不复制到正式内容目录。

环境变量必须是绝对路径；相对路径、旧版本、未批准包和哈希不符包全部拒绝。

## 导入计划

默认只查看计划：

```powershell
npm run journal:import -- --package <approved-publish-package-path>
```

输出包括目标文件、碰撞、语言数量、当前哈希和预计动作。导入记录进入普通 blog collection；中文文章可以单独存在，英文版本仍可沿用现有博客语言规则。

实际写入必须显式授权：

```powershell
npm run journal:import -- --package <approved-publish-package-path> --apply
```

目标文件存在时默认失败。替换必须同时提供当前文件的准确旧哈希：

```powershell
npm run journal:import -- --package <approved-publish-package-path> --apply --expected-old-hash <sha256>
```

导入只写本地工作树，不提交、不推送、不发布。

## 验证

```powershell
npm run test:human-agency
npm run typecheck
npm run build
```

`test:human-agency` 覆盖共享合法/非法/旧版本夹具、预览开关、哈希校验、普通博客映射、旧独立路由移除、默认 dry-run、碰撞和旧哈希替换门禁。`human-agency:check-types` 会阻止交换 Schema 与生成类型漂移，并已纳入 `npm run verify`。
