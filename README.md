# xgwnje.cn Signal Homepage

这是 `xgwnje.cn` 新方向的独立起点，不从旧 `My-server/Home-page` 继承代码。

目标不是做“电台界面”，而是做一个带有抽象信号气质的个人内容索引站：

- 首页内容优先，视觉作为氛围层。
- 内容类型先保持三类：`笔记`、`影像`、`作品`。
- 抽象信号动效使用 Canvas，不依赖重型 3D。
- 第一版先验证结构、阅读体验和视觉方向。

## 项目结构

```text
/
├── public/
│   └── scripts/
│       ├── content-index.js
│       └── signal-field.js
├── src/
│   ├── components/
│   ├── content/
│   │   └── posts/
│   ├── layouts/
│   ├── pages/
│   │   ├── index.astro
│   │   └── posts/[id].astro
│   ├── styles/
│   └── content.config.ts
└── package.json
```

## 内容模型

所有内容先放在：

```text
src/content/posts/
```

每篇 Markdown 需要 frontmatter：

```yaml
title: "标题"
summary: "摘要"
pubDate: "2026-06-28"
contentType: "note" # note | video | work
tags: ["tag"]
featured: false
```

## 命令

在项目根目录运行：

| Command | Action |
| :-- | :-- |
| `npm install` | 安装依赖 |
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 构建静态站点 |
| `npm run preview` | 预览构建结果 |
