---
title: "Hello, XGWNJE Index"
description: "A clean English sample post used to verify content rendering, comments, views, RSS, tags, and bilingual article pairing after the old posts were removed."
pubDate: 2026-07-10
updatedDate: 2026-07-10
lang: "en"
author: "XGWNJE"
group: "hello-xgwnje-index"
tags: ["XGWNJE", "Blog", "Example"]
important: true
importantOrder: 10
category: "Blog"
---

## What this post is for

This is the first clean sample post for XGWNJE Index. It is not meant to be the final long-form article. It exists so the site can verify that the article pipeline still works after the old content has been removed.

This post appears on the homepage, blog list, important posts, archive, tags, RSS feeds, and the post detail page. The detail page also keeps the existing views, comments, table of contents, code copy, back-to-top, and image preview behavior.

## Content structure

Future posts should keep using the same bilingual pattern:

- Chinese posts use `lang: "cn"`.
- English posts use `lang: "en"`.
- Both versions of the same post share one `group`.
- File names should generally follow `slug-cn.md` and `slug-en.md`.

That keeps content pairing, article switching, RSS split feeds, and related-post logic stable.

## Sample code block

```powershell
npm run test:content
npm run test:i18n
npm run build
```

These commands check bilingual content pairs, the UI language wiring, and the final site build.

## Next step

When replacing this sample with the first real post, keep the `lang`, `group`, and date fields in the frontmatter. The body can be rewritten freely. Put images in stable public assets or a reliable image host so future deployments do not break them.
