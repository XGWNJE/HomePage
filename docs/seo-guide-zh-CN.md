# XGWNJE SEO 指南

本文负责当前 VPS/Nginx 站点的 Sitemap、robots、站长平台、IndexNow 和发布后验证。

## 当前入口

- 站点：`https://xgwnje.cn/`
- robots：`https://xgwnje.cn/robots.txt`
- Sitemap：`https://xgwnje.cn/sitemap.xml`
- Sitemap index：`https://xgwnje.cn/sitemap-index.xml`
- 综合 RSS：`https://xgwnje.cn/feed.xml`
- 中文 RSS：`https://xgwnje.cn/feed-zh.xml`
- 英文 RSS：`https://xgwnje.cn/feed-en.xml`

`@astrojs/sitemap` 在构建时生成 Sitemap，构建脚本确保兼容入口 `sitemap.xml` 存在。Nginx 是当前生产服务层，不使用其他平台专用的 headers 或构建步骤。

## 页面基础要求

每个可索引页面应具备：

- 独立且准确的 `title` 和 description。
- 指向生产 URL 的 canonical。
- 与内容一致的 Open Graph 标题、描述和图片。
- 描述性 URL、语义化标题层级和有效内部链接。
- 图片 alt 文本与可访问的静态资源。

管理页、内部页和分页重复页按源码策略排除或 `noindex`。

## 本地验证

```powershell
npm run build

Test-Path dist/robots.txt
Test-Path dist/sitemap.xml
Test-Path dist/sitemap-index.xml
Get-ChildItem dist -Filter 'sitemap*.xml'
```

再检查：

- `dist/robots.txt` 指向生产 `sitemap.xml`。
- Sitemap 只包含公开页面，不包含管理入口。
- 新文章 URL、语言版本和 canonical 正确。
- `public/image/og-default.png` 是 1200×630 的有效 PNG。

## 生产验证

```bash
curl -fsSI https://xgwnje.cn/robots.txt
curl -fsSI https://xgwnje.cn/sitemap.xml
curl -fsSI https://xgwnje.cn/sitemap-index.xml
curl -fsSI https://xgwnje.cn/feed.xml
```

预期结果：

- HTTP 200。
- Sitemap 和 RSS 返回 XML 内容类型。
- URL 与 `xgwnje.cn` 一致，没有旧 Pages 域名。

## Google Search Console

1. 使用域名资源添加 `xgwnje.cn`。
2. 优先通过 DNS 完成所有权验证；共享 DNS 事实在 `Server-infra` 维护。
3. 提交 `https://xgwnje.cn/sitemap.xml`。
4. 发布新文章后用 URL 检查确认 canonical 和抓取状态。

验证值不提交到仓库。

## Bing Webmaster Tools 与 IndexNow

1. 添加并验证 `xgwnje.cn`。
2. 提交 `https://xgwnje.cn/sitemap.xml`。
3. 在私有 shell 环境设置 `INDEXNOW_KEY` 和 `INDEXNOW_HOST`，不要写入文件或命令示例。
4. 构建和发布完成后运行：

```powershell
npm run indexnow:sitemap
```

也可以只通知指定的已发布 URL：

```powershell
npm run indexnow -- https://xgwnje.cn/blog/hello-xgwnje-index-cn/
```

不要在构建阶段自动通知尚未上线的 URL。

## 常见排查

| 症状 | 检查 |
| --- | --- |
| Sitemap 404 | 构建输出、静态 release 内容、Nginx root |
| URL 仍指向旧域名 | Astro site/base、canonical、Sitemap 内容 |
| 新文章未出现 | 内容是否为公开状态、构建是否包含、Sitemap 是否更新 |
| IndexNow 拒绝 | host、key 所属域名、URL 是否同域且已上线 |
| 社交卡片错误 | OG 图片格式、尺寸、绝对 URL 和缓存 |

站长平台账号、验证值和 IndexNow key 都属于外部敏感配置，不在本仓库维护。
