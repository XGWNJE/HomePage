# Adaptive Article TOC Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让文章页根据可导航标题数量自动选择目录布局或居中布局，并让后续普通 Markdown 文章继续使用轻量 `ContentOnly` 发布。

**Architecture:** `BlogPost.astro` 继续使用 Astro 渲染得到的 `headings`，但只有至少两个 `H2–H4` 标题时才启用目录。无目录时不渲染桌面侧栏或移动端抽屉，并把正文容器切换为居中阅读宽度；写作规则只约束结构选择，不增加 frontmatter 或新 Markdown 语法。

**Tech Stack:** Astro 5、TypeScript、Node.js test runner、Tailwind CSS、PowerShell 发布脚本。

## Global Constraints

- 至少两个可识别的 `H2–H4` 标题才启用目录布局。
- 零个或一个可识别标题时使用居中布局，不保留空侧栏。
- 不增加 frontmatter 开关、隐藏标题、自定义 Markdown 指令或新依赖。
- 首次实现运行 `npm run verify` 和桌面/移动端浏览器验收。
- 后续普通 `.md` 文章仍使用 `ContentOnly`，不得附加前端完整测试或浏览器矩阵。
- 当前生产代码 revision 与 `main` 不一致时，发布前必须检查完整差异；不得借本次布局修改夹带其他未授权工程改动。

---

## File Map

- Create `scripts/blog-post-layout.test.ts`：锁定目录阈值、条件渲染和无目录居中布局。
- Modify `src/layouts/BlogPost.astro`：实现唯一的 `hasToc` 判定和两套条件布局。
- Modify `AGENTS.md`：定义审核稿的章节导航稿与短文居中稿。
- Modify `docs/site-maintenance.zh-CN.md`：记录编辑方式、首次验证和后续快速发布边界。
- Modify `scripts/project-config.test.ts`：防止维护文档把普通文章重新升级为复杂发布流程。

### Task 1: Implement the adaptive layout with TDD

**Files:**
- Create: `scripts/blog-post-layout.test.ts`
- Modify: `src/layouts/BlogPost.astro`

**Interfaces:**
- Consumes: Astro `render(post)` 产生的 `{ depth, slug, text }[]` headings。
- Produces: `hasToc: boolean`，由桌面侧栏、移动端目录和文章容器共同使用。

- [ ] **Step 1: Write the failing layout contract test**

Create `scripts/blog-post-layout.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const layoutUrl = new URL('../src/layouts/BlogPost.astro', import.meta.url);

test('article TOC requires at least two navigable headings', async () => {
	const source = await readFile(layoutUrl, 'utf8');
	assert.match(source, /const hasToc = tocItems\.length >= 2;/u);
	assert.match(source, /<Header showTocButton=\{hasToc\} \/>/u);
});

test('TOC chrome renders only in TOC mode', async () => {
	const source = await readFile(layoutUrl, 'utf8');
	assert.match(source, /\{hasToc && <TocDrawer headings=\{tocItems\} \/>\}/u);
	assert.match(source, /metaMode !== 'page' && hasToc && \([\s\S]*?<TocSidebar headings=\{tocItems\} \/>/u);
	assert.doesNotMatch(source, /Placeholder keeps first paint geometry stable/u);
});

test('articles without useful navigation use a centered reading column', async () => {
	const source = await readFile(layoutUrl, 'utf8');
	assert.match(source, /hasToc[\s\S]*?'md:grid md:grid-cols-\[240px_minmax\(0,1fr\)\][\s\S]*?: 'mx-auto max-w-\[820px\]'/u);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run `npx tsx --test scripts/blog-post-layout.test.ts`.

Expected: three failures because the current layout uses `tocItems.length > 0`, renders `TocDrawer` unconditionally, and retains the empty sidebar placeholder.

- [ ] **Step 3: Implement the minimal conditional layout**

Change the shared threshold in `src/layouts/BlogPost.astro`:

```ts
const hasToc = tocItems.length >= 2;
```

Make mobile TOC conditional:

```astro
<Header showTocButton={hasToc} />
<MobileDrawer />
{hasToc && <TocDrawer headings={tocItems} />}
```

Select the article grid or centered column from the same flag:

```astro
<div class:list={[
	'mt-10 min-w-0',
	metaMode === 'page'
		? 'mx-auto max-w-3xl'
		: hasToc
			? 'md:grid md:grid-cols-[240px_minmax(0,1fr)] md:gap-10 lg:grid-cols-[280px_minmax(0,820px)_minmax(0,1fr)] lg:gap-x-10'
			: 'mx-auto max-w-[820px]',
]}>
```

Replace the unconditional sidebar and placeholder with this conditional sidebar:

```astro
{
	metaMode !== 'page' && hasToc && (
		<aside class="hidden md:block" data-toc-fade-wrap>
			<div class="sticky top-24 self-start">
				<div class="relative">
					<div class="toc-scroll max-h-[calc(100vh-7.5rem)] overflow-auto pr-2" data-toc-scroll="sidebar">
						<TocSidebar headings={tocItems} />
					</div>
					<div data-toc-fade="top" class="toc-fade toc-fade-top pointer-events-none absolute inset-x-0 top-0 h-8 opacity-0"></div>
					<div data-toc-fade="bottom" class="toc-fade toc-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 h-8 opacity-0"></div>
				</div>
			</div>
		</aside>
	)
}
```

Keep main-column placement conditional:

```astro
<main class:list={[
	'min-w-0',
	metaMode !== 'page' && hasToc && 'lg:col-start-2',
]}>
```

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run `npx tsx --test scripts/blog-post-layout.test.ts scripts/blog-post-runtime.test.ts`.

Expected: all layout and route-transition runtime tests pass.

- [ ] **Step 5: Commit the layout behavior**

```powershell
git add -- scripts/blog-post-layout.test.ts src/layouts/BlogPost.astro
git commit -m "实现文章目录自适应布局"
```

### Task 2: Lock the editorial and release policy

**Files:**
- Modify: `scripts/project-config.test.ts`
- Modify: `AGENTS.md`
- Modify: `docs/site-maintenance.zh-CN.md`

**Interfaces:**
- Consumes: Task 1 的 `hasToc` 自动判定。
- Produces: 审核稿结构规则，以及普通 Markdown 后续仍走 `ContentOnly` 的维护契约。

- [ ] **Step 1: Write the failing policy regression test**

Append to `scripts/project-config.test.ts`:

```ts
test('article policy documents adaptive TOC layout without burdening later content releases', async () => {
	const agents = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
	const maintenance = await readFile(new URL('../docs/site-maintenance.zh-CN.md', import.meta.url), 'utf8');
	assert.match(agents, /至少两个可识别的章节标题/u);
	assert.match(agents, /零个或一个标题.*正文居中/u);
	assert.match(maintenance, /后续普通.*\.md.*ContentOnly/u);
	assert.match(maintenance, /不因文章选择目录布局或居中布局.*完整验证/u);
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run `npx tsx --test scripts/project-config.test.ts`.

Expected: the new policy test fails because the adaptive-layout wording is absent.

- [ ] **Step 3: Add the editorial policy**

Add under `AGENTS.md` “内容与资产”:

```markdown
- 选题进入可审核稿时按文章结构选择布局：至少两个可识别的章节标题时使用原生 `##` / `###` 形成导航；标题应是自然过渡句，不为凑目录制造空章节。零个或一个标题的短文、连续叙事由文章页自动隐藏目录并让正文居中。该选择不增加 frontmatter 或专用组件。
```

Add to `docs/site-maintenance.zh-CN.md`:

```markdown
### 章节导航与短文布局

审核稿不设统一标题数量。至少两个可识别章节标题时，文章页自动显示桌面目录和移动端目录；零个或一个标题时自动使用无目录的居中阅读布局。章节标题优先写成符合语气的自然过渡句，不使用空标题、HTML 隐藏标题或只为凑目录存在的章节。

布局由 Markdown 标题自动判断，不需要 frontmatter。首次修改这套共享布局时运行完整验证；后续普通 `.md` 文章仍走 `ContentOnly`，不因文章选择目录布局或居中布局而重复前端完整验证或浏览器矩阵。
```

- [ ] **Step 4: Run policy and layout tests**

Run `npx tsx --test scripts/project-config.test.ts scripts/blog-post-layout.test.ts`.

Expected: all tests pass.

- [ ] **Step 5: Commit the policy contract**

```powershell
git add -- AGENTS.md docs/site-maintenance.zh-CN.md scripts/project-config.test.ts
git commit -m "约束文章章节与居中布局"
```

### Task 3: Complete first-run verification and release-scope gate

**Files:**
- Temporary local fixture only: `src/content/blog/toc-layout-preview-cn.md` (remove before completion)
- Verify: repository and production release state

**Interfaces:**
- Consumes: Tasks 1–2 的布局与规则。
- Produces: 首次完整验证证据，以及是否可以安全发布的明确结论。

- [ ] **Step 1: Run full repository verification**

Run `npm run verify`.

Expected: unit tests, content checks, typecheck, production build, and API tests all pass.

- [ ] **Step 2: Create a temporary no-heading preview fixture**

Use `apply_patch` to add this uncommitted `src/content/blog/toc-layout-preview-cn.md`:

```markdown
---
title: "无目录居中布局验收"
description: "只用于首次验证文章页无目录布局。"
pubDate: 2026-07-18
lang: "cn"
author: "XGWNJE"
group: "toc-layout-preview"
tags: ["Test"]
category: "Notes"
draft: false
---

这是一篇没有章节标题的短文，用于确认正文居中，并且页面不会保留空目录栏。

第二段用于形成真实的阅读宽度，不引入任何导航标题。
```

Do not commit the fixture.

- [ ] **Step 3: Run external Chrome acceptance**

Start `npm run dev -- --host 127.0.0.1` and use the user's normal Chrome session.

Verify desktop `1440×900` and mobile `390×844`:

- `/blog/toc-layout-preview-cn/` has no desktop TOC, no mobile TOC button, no horizontal overflow, width at most 820px, and a centered reading column.
- `/blog/ai-bug-report-achievement-cn/` retains six TOC entries whose links target real `h2[id]` elements.
- Console has no new error and affected routes have no failed local resource request.

- [ ] **Step 4: Remove temporary resources**

Delete the fixture with `apply_patch`, stop the preview server, and run `git status --short`.

Expected: no fixture, screenshot, browser profile, or build output is tracked.

- [ ] **Step 5: Gate production release scope**

Run:

```powershell
npm run content:release:plan
git diff --name-only 40b891733b181e19613532c2e35433495a51d929..HEAD
```

Expected: `ContentOnly` excludes the layout file, while a normal current-HEAD frontend release would include unrelated production-pending engineering changes. Stop before publishing and report the exact scope unless the user separately authorizes those pending changes or approves an isolated production-base frontend release design.

---

## Completion Checklist

- [ ] TOC threshold and conditional rendering tests pass.
- [ ] No-TOC articles render centered without an empty sidebar.
- [ ] TOC articles keep desktop and mobile navigation.
- [ ] Editorial and maintenance rules describe both content structures.
- [ ] `npm run verify` passes on the final committed tree.
- [ ] Temporary preview resources are removed.
- [ ] No production publish occurs through a scope that would include unrelated changes without explicit authorization.
