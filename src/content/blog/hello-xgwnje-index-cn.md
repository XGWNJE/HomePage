---
title: "你好，XGWNJE Index"
description: "这是一篇新的中文示例文章，用来验证博客内容、评论、浏览量、RSS、标签和中英双语配对功能都能正常运行。"
pubDate: 2026-07-10
updatedDate: 2026-07-10
lang: "cn"
author: "XGWNJE"
group: "hello-xgwnje-index"
tags: ["XGWNJE", "Blog", "Example"]
important: true
importantOrder: 10
category: "Blog"
---

## 这篇文章的作用

这是 XGWNJE Index 的第一篇示例文章。它不是最终的正式内容，而是一个干净的起点，用来确认文章系统在清空旧内容后仍然完整可用。

这篇文章会出现在首页、博客列表、重要文章、归档、标签页、RSS 和文章详情页中。文章详情页还会继续保留浏览量、评论、目录、代码复制、返回顶部和图片预览等原有功能。

## 内容策略

后续正式文章可以继续沿用当前结构：

- 中文文章使用 `lang: "cn"`。
- 英文文章使用 `lang: "en"`。
- 同一篇文章的中英文版本使用同一个 `group`。
- 文件名建议保持 `slug-cn.md` 和 `slug-en.md` 的形式。

这样站内的内容配对、语言切换、RSS 分流和相关文章逻辑都能保持稳定。

## 示例代码块

```powershell
npm run test:content
npm run test:i18n
npm run build
```

这些命令分别检查文章双语配对、UI 双语入口和站点构建结果。

## 下一步

把这篇文章替换成真正的第一篇博客时，只需要保留 frontmatter 中的 `lang`、`group` 和基础日期字段。正文可以自由改写，图片建议放在公开资源目录或稳定的图床地址中，避免迁移后失效。
