# About Clear-Eyed Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overstated About page with the approved honest dual-character narrative, add a reusable dialogue component, validate it locally and in a real browser, then deploy only the frontend to production without committing or pushing Git.

**Architecture:** Keep `BlogPost.astro` unchanged. Add one small presentational component for narrator/owner notes, rebuild `about.astro` inside the existing page layout, and use the approved Sandrone assets from `public/image/sandrone/`. Protect the factual boundary with a source-level regression test and publish the verified dirty worktree as a hash-identified frontend artifact through the project deployment contract.

**Tech Stack:** Astro 7, Tailwind CSS 4 utility classes, Node.js source assertions, project `npm run verify`, real Chrome, Nginx static frontend release.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-10-about-clear-eyed-profile-design.md` exactly.
- Station claims remain first-person and factual; Sandrone refers to the station owner in third person.
- Do not use senior-engineer, expert, founder, mature-product, large-user-base, industry-impact, or inevitable-success claims.
- Preserve all existing navigation, contact-modal behavior, light/dark themes, and About source attribution.
- Use `/image/sandrone/about-observer-v1.webp` and `/image/sandrone/dialog-chibi-v1.webp`; do not regenerate assets.
- Do not change backend code, persistent data, Nginx configuration, or any other hosted project.
- Do not commit, push, tag, or create a release in Git. Production uses a dirty-worktree manifest identity.
- Frontend-only deployment: `server/`, `homepage-api.service`, SQLite, uploads, and API revision remain unchanged.

---

### Task 1: Add a Failing About Contract Test

**Files:**
- Create: `scripts/check-about-page.mjs`
- Modify: `package.json`
- Test: `scripts/check-about-page.mjs`

**Interfaces:**
- Consumes: raw source for `src/pages/about.astro`, `src/components/CharacterDialogue.astro`, and the two selected assets.
- Produces: `npm run test:about`, included in the repository's normal `npm test` chain.

- [ ] **Step 1: Create the test before production code**

The test must assert:

```js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const about = readFileSync('src/pages/about.astro', 'utf8');
const componentPath = 'src/components/CharacterDialogue.astro';

assert(existsSync(componentPath), 'CharacterDialogue component must exist');
const component = readFileSync(componentPath, 'utf8');

assert.match(about, /关于这里的主人/);
assert.match(about, /我不是专业开发者，也暂时没有代表作/);
assert.match(about, /对 AI Agent/);
assert.match(about, /about-observer-v1\.webp/);
assert.match(about, /CharacterDialogue/);
assert.match(about, /非官方虚拟助手形象/);
assert.match(about, /open-contact-modal/);
assert.doesNotMatch(about, /资深程序员|软件工程师|技术专家|独立开发者|创业者|产品创始人|AI 研究者|架构师|Agent 专家/);
assert.doesNotMatch(about, /产品矩阵|技术生态|大量用户|行业影响|改变世界|技术前沿/);
assert.match(component, /<aside/);
assert.match(component, /avatarAlt/);
assert(existsSync('public/image/sandrone/about-observer-v1.webp'));
assert(existsSync('public/image/sandrone/dialog-chibi-v1.webp'));
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/check-about-page.mjs`

Expected: failure because `CharacterDialogue.astro` does not exist and the old About lacks the approved copy.

- [ ] **Step 3: Register the test command**

Add `"test:about": "node scripts/check-about-page.mjs"` and insert `npm run test:about` in the root `test` chain. Do not change unrelated scripts.

### Task 2: Build the Reusable Dialogue Component

**Files:**
- Create: `src/components/CharacterDialogue.astro`
- Test: `scripts/check-about-page.mjs`

**Interfaces:**
- Consumes props `speaker`, optional `role`, optional `avatar`, optional `avatarAlt`, and `variant: 'narrator' | 'owner'`.
- Produces a semantic `<aside>` with an optional image and a default content slot.

- [ ] **Step 1: Implement the minimal typed component**

Use an `interface Props` and default `variant="narrator"`. The narrator variant uses a restrained deep-red/antique-gold/cyan accent and the owner variant uses the existing neutral zinc palette. The avatar is rendered only when supplied; it uses `object-contain`, never overlaps text, and has an explicit `alt` value.

- [ ] **Step 2: Keep component behavior presentational**

The component must contain no timers, hydration directive, client JavaScript, navigation, or data loading. It only renders `speaker`, `role`, avatar, and slot content.

### Task 3: Rebuild the About Page

**Files:**
- Modify: `src/pages/about.astro`
- Consume: `src/components/CharacterDialogue.astro`
- Consume: `public/image/sandrone/about-observer-v1.webp`
- Consume: `public/image/sandrone/dialog-chibi-v1.webp`
- Test: `scripts/check-about-page.mjs`

**Interfaces:**
- Consumes the existing `BlogPost.astro`, `TerminalQuote`, background components, contact-modal event, and new dialogue component.
- Produces the approved eight-section About experience without using the layout's 16:9 `heroImage` slot.

- [ ] **Step 1: Update metadata and status copy**

Set title to `关于这里的主人`, use the approved factual description, and set `nowText` to:

```text
Now: learning how to work with AI agents, testing small ideas, and keeping the useful parts.
```

- [ ] **Step 2: Add the responsive introduction card**

Create a rounded two-column section inside the About body. Text is left and `/image/sandrone/about-observer-v1.webp` is right on desktop; image is first on mobile. Use a bounded portrait container with `object-cover` and a top-biased focal point so the face, headpiece, hands, and primary costume remain visible.

- [ ] **Step 3: Insert the approved full narrative**

Use the exact copy and section order from the design spec:

1. 引导区
2. 先把称呼说清楚
3. 这些项目是什么
4. 桑多涅的观察
5. 为什么要记录
6. 关于这个博客
7. 现在
8. 联系与角色声明

Use ordinary paragraphs for facts, linked project cards for the five project groups, narrator dialogue cards for Sandrone, and owner dialogue cards only for short first-person replies. Do not turn the page into a script.

- [ ] **Step 4: Preserve existing functionality**

Keep all project/source links, the contact button, and the `open-contact-modal` event. Add the non-official character statement at the bottom. Do not add client-side state or new external dependencies.

- [ ] **Step 5: Add scoped responsive polish**

Use existing typography and site colors. Add only About-specific layout rules needed for the split intro, project card grid, dialogue spacing, and mobile image crop. Respect `prefers-reduced-motion`; no new required motion.

### Task 4: Verify GREEN and the Full Repository

**Files:**
- Verify all Task 1–3 files and existing repository behavior.

**Interfaces:**
- Consumes the completed implementation.
- Produces evidence that the source contract and full repository gates pass.

- [ ] **Step 1: Run About test and verify GREEN**

Run: `npm run test:about`

Expected: exit 0 with no assertion failure.

- [ ] **Step 2: Install reproducible dependencies**

Run:

```powershell
npm ci
npm ci --prefix server
```

Expected: both commands exit 0.

- [ ] **Step 3: Run unified verification**

Run: `npm run verify`

Expected: unit/content/brand/header/links/i18n/admin/About tests, typecheck, build, sitemap, and API tests all pass.

- [ ] **Step 4: Check encoding and asset references**

Verify modified Chinese files are UTF-8 without BOM or replacement characters, `git diff --check` is clean, and both referenced images exist.

### Task 5: Real Chrome Acceptance

**Files:**
- Runtime target: `http://127.0.0.1:4321/about/`

**Interfaces:**
- Consumes a locally running Astro site.
- Produces desktop/mobile screenshots and interaction evidence from the user's real Chrome session.

- [ ] **Step 1: Start the local frontend**

Run: `npm run dev -- --host 127.0.0.1`

Expected: local Astro URL is reachable.

- [ ] **Step 2: Verify desktop About**

Check the split hero, text hierarchy, image focal point, light and dark themes, no broken images, no horizontal overflow, and no console errors.

- [ ] **Step 3: Verify mobile About**

Use a mobile viewport. Check image-first stacking, dialogue cards, project cards, Q-character decoration, text readability, and absence of clipping or overlap.

- [ ] **Step 4: Verify contact behavior and key regression routes**

Open the contact form from About. Also load `/`, `/blog/`, `/tags/`, and one article to confirm shared layout behavior remains intact.

### Task 6: Frontend-Only Production Preflight

**Files:**
- Execute: `.agents/skills/deploy-homepage/scripts/preflight.ps1`
- Read-only server truth: `D:/ObjectCode/Server-infra/server.local.env` and relevant inventory/Nginx documents.

**Interfaces:**
- Consumes the verified dirty worktree and live infrastructure source of truth.
- Produces a release ID, frontend artifact hash, manifest hash, production baseline, and rollback target.

- [ ] **Step 1: Confirm scope and dirty status**

Record branch, `git status`, changed-file scope, and explicit authorization to deploy uncommitted content. State that backend and Nginx remain unchanged.

- [ ] **Step 2: Run dirty-worktree preflight**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/deploy-homepage/scripts/preflight.ps1 -AllowDirty
```

Expected: full `npm run verify` passes and required server-local keys are present without secret output.

- [ ] **Step 3: Capture live infrastructure and other-project baselines**

Using `D:/ObjectCode/Server-infra` and the VPS connection skill, verify host identity, disk, Nginx config, static root, current HomePage/API health, and baseline endpoints for every other routed project before uploading.

- [ ] **Step 4: Build the frontend artifact and manifest**

Generate a unique `release_id`; package `dist/`; record file count, total bytes, `index.html` SHA-256, artifact SHA-256, Node/npm versions, Git dirty state, changed-file list, build time, and manifest SHA-256. Use a `worktree-<frontend-sha12>` revision label for this frontend-only dirty release record.

### Task 7: Deploy and Verify Production

**Files:**
- Production static root: `/var/www/xgwnje-home`
- Production backup: a release-ID-specific sibling backup directory.

**Interfaces:**
- Consumes the hashed frontend artifact and verified baseline.
- Produces an atomically switched static site with a preserved rollback backup.

- [ ] **Step 1: Upload to a new remote temporary path**

Verify the uploaded tar SHA-256 matches locally before extraction. Check `index.html`, file count, and total bytes in the new directory.

- [ ] **Step 2: Atomically switch only the frontend**

Rename the current static root to the release-ID backup and move the new directory into `/var/www/xgwnje-home`, with a failure trap that restores the backup. Do not reload Nginx because configuration is unchanged.

- [ ] **Step 3: Verify public routes and isolation**

Check production `/`, `/about/`, `/blog/`, `/tags/`, one Chinese article, one English article, `/admin/`, RSS, Sitemap, API health, and a random 404. Re-check all other Nginx project baseline endpoints and service/listener state.

- [ ] **Step 4: Verify production in real Chrome**

Check About desktop/mobile visuals, assets, contact form, console, and overflow on `https://xgwnje.cn/about/`.

- [ ] **Step 5: Report release and rollback evidence**

Report release ID, dirty-worktree revision, frontend artifact and manifest hashes, production backup path, Nginx unchanged, backend unchanged, route/browser results, other-project isolation results, and the exact rollback entry point. Do not commit or push.
