---
title: "When Your Agent Can't Draw: I Taught It a Skill"
description: "My go-to agent has no native image generation, but the blog needed covers, icons, and illustrations. Instead of hand-teaching it the API every time, I distilled the capability into a Skill. This post records the judgments I made as the one driving the agent — not the work the AI did."
pubDate: 2026-07-27
updatedDate: 2026-07-27
lang: "en"
author: "XGWNJE"
group: "agent-cannot-draw-skill"
tags: ["AI Agent", "Skill", "Workflow", "Notes"]
category: "Notes"
draft: false
---

While making a favicon for this blog, I realized my main agent simply has no organ for drawing. Switch to an agent that can draw, call the image API by hand every time, or teach it? I chose the third: distill the capability into a Skill file — teach once, effective forever. What follows are the judgments I made as the one driving it, not a log of its work.

![A small robot stands before a blank easel as a glowing skill card floats into its open hand](/image/blog/agent-cannot-draw-skill/hero.webp)

**1. Fill capability gaps with assets, not one-off instructions.** Teaching it ad hoc each time means repeating myself forever and re-hitting the same pitfalls in every new conversation. Written as a Skill, a consumable becomes an asset.

![Scattered paper sheets converge and solidify into a single stone block](/image/blog/agent-cannot-draw-skill/asset.webp)

**2. Goals first, but anchor a reference standard.** A step-by-step manual goes stale; pure goals drift — every run improvises a different path and stability suffers. So the body states goals and acceptance criteria, while the mechanisms without which the task simply cannot be done are pinned verbatim: the superstructure may improvise, the foundation may not be relaid.

![A kite flies freely in the sky, tethered by a thin line to a solid anchor on the ground](/image/blog/agent-cannot-draw-skill/anchor.webp)

**3. What I must write myself is the bottom line.** Zero key exposure, confirm before paid calls, when to ask and when not to — these are my values, not technical knowledge, and no one can write them for me.

**4. A Skill is a fallback, not a lock-in.** If the agent can draw natively, prefer that. What I accumulate must outlive any single model.

The biggest gain is methodological: leave the methods to the AI, keep the standards and bottom lines to myself. A user gets results; a driver gets capabilities.

## Share

The drawing Skill from this post is open source — take it as-is or reshape it into your own: [HarnessOS/skills/grsai-image-gen](https://github.com/XGWNJE/HarnessOS/tree/master/skills/grsai-image-gen).
