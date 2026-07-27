---
title: "Agent 不会画图怎么办：我给它补了一门「技能」"
description: "手头的主力 Agent 没有原生绘图能力，但博客配图、图标、封面都等着用。解法不是每次手把手教它调 API，而是把这件事沉淀成一个 Skill——这篇文章记的是我作为驾驭者想清楚的几个判断，而不是 AI 干活的过程。"
pubDate: 2026-07-27
updatedDate: 2026-07-27
lang: "cn"
author: "XGWNJE"
group: "agent-cannot-draw-skill"
tags: ["AI Agent", "Skill", "工作流", "Notes"]
category: "Notes"
draft: false
---

给博客做 favicon 那天我发现：主力 Agent 根本没有生图这个器官。换会画图的 Agent、每次手动调 API、还是教它学会？我选了第三条——把这件事沉淀成一个 Skill 文件，教一次，永久生效。这里记的是我作为驾驭者想清楚的几个判断，不是它干活的过程。

![小机器人站在空白画架前，一张发光的技能卡飘入它摊开的手掌](/image/blog/agent-cannot-draw-skill/hero.webp)

**一、能力缺口要沉淀成资产，不用一次性指令填。** 每次贴文档临时教它，同样的话说一遍又一遍，踩过的坑换个对话就忘。写成 Skill，消耗品就变成了资产。

![散落的纸片向右汇聚，凝结成一块坚固的石块](/image/blog/agent-cannot-draw-skill/asset.webp)

**二、目标为主，但必须有锚定的标准。** 操作手册会过时，纯目标又太飘——每次自由发挥路径不一，稳定性太差。所以主体写目标和验收标准，把"离开它任务就做不成"的机制原样写死：主体可以临场决定，地基不许重打。

![风筝在天空中自由飞翔，一根细线把它拴在地面坚固的锚上](/image/blog/agent-cannot-draw-skill/anchor.webp)

**三、真正要亲自写的是底线。** 密钥零暴露、付费调用先确认、什么时候该问什么时候别问——这些是我的价值观，不是技术知识，没人能替我写。

**四、Skill 是兜底，不是绑定。** Agent 自己会画就优先用原生能力。沉淀在我这里的资产，必须比任何单一模型的生命周期都长。

最大的收获是方法论：做法留给 AI，标准和底线留给自己。使用者得到结果，驾驭者得到能力。

## 分享

文中这个绘图 Skill 已经开源，可以直接拿走用或改成你自己的版本：[HarnessOS/skills/grsai-image-gen](https://github.com/XGWNJE/HarnessOS/tree/master/skills/grsai-image-gen)。
