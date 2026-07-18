---
title: "AI Did Most of the Work. Sending the Bug Report to OpenAI Still Felt Great."
description: "A four-second input freeze became an engineering bug report sent to OpenAI support. AI handled most of the analysis and writing, but judgment, boundaries, and responsibility still belonged to a person."
pubDate: 2026-07-18
updatedDate: 2026-07-18
lang: "en"
author: "XGWNJE"
group: "ai-bug-report-achievement"
tags: ["Codex", "AI Agent", "Human-AI Collaboration", "Windows", "Notes"]
category: "Notes"
draft: false
---

A line appeared in the OpenAI support chat: the conversation had been escalated to a support specialist, and someone would follow up by email.

No fix had shipped. No engineer had confirmed the root cause. I did not even have a formal ticket number. All that had happened was that a short explanation and a five-page PDF had finally left my computer and entered OpenAI's support process.

Seeing that line still felt great.

![OpenAI support chat showing that the Codex for Windows bug report was escalated to a support specialist](/image/blog/ai-bug-report-achievement/support-escalated.webp)

## A four-second freeze finally left evidence

The story did not begin dramatically. The Codex Windows desktop app froze my input again. The keys I pressed were not lost; nothing appeared for about four seconds, and then the text arrived in the input box all at once. Four seconds is not long, but it is long enough to break a train of thought. Worse, this kind of problem is easy to dismiss as “the computer lagged for a moment.” It definitely happened, but by the time you try to explain it, the scene has already disappeared.

This time, I had an ETW trace. ETW is Windows' built-in event tracing system, capable of recording what the operating system and an application were doing over a period of time. Codex analyzed a 43.313-second trace with zero lost events and found nine delayed keyboard messages. The longest delay was 4,032 milliseconds. Those four seconds were no longer just a feeling; they had left a shape in the data.

## AI did nearly all of the hard labor

Most of the analysis that followed was not mine.

Codex traced a performance hotspot to runtime path resolution in Browser Use. It proposed that synchronous SHA-256 work may have repeatedly read and hashed roughly 1.343 GiB of data. Disk utilization, network activity, and driver interrupts did not show a blockage of comparable scale. Codex organized the timeline, compared the metrics, assembled the evidence, and turned it into an English report. Put bluntly, from collecting the data to interpreting it and writing something an engineering team could use, AI did nearly all of the hard labor.

## An elegant explanation is still only an explanation

But I did not immediately treat its conclusion as fact.

My computer uses a SATA drive, and its CPU is not new. If the storage and processor were already slow, was this really a Codex defect, or had ordinary work simply become a visible freeze on weaker hardware? I kept asking that question. I also required the report to state the boundary clearly: the input freeze itself was confirmed; the synchronous-hashing explanation was a high-confidence engineering hypothesis derived from the trace, not a root cause confirmed by OpenAI.

I asked for another, less flattering statement to be included: the analysis had been performed by OpenAI Codex under my direction, I had not independently validated the technical conclusions, and I could not guarantee that the attribution was completely accurate.

That sentence weakened the report's force, but made it more worthy of being taken seriously. AI is very good at arranging scattered evidence into a complete and elegant explanation. The elegance is precisely where the danger lies. The smoother a conclusion reads, the easier it is to forget that it remains a conclusion. I cannot pretend I have the ability to validate every technical detail independently. I can, at least, refuse to hide the uncertainty.

![The accuracy statement and five-page PDF bug report attached in the OpenAI support conversation](/image/blog/ai-bug-report-achievement/report-attached.webp)

## Stop proving it locally and hand it upstream

Codex also suggested continuing with local A/B tests: change one condition, reproduce the problem, and see whether the freeze disappeared with it. That would have made the investigation more complete, but it was inconvenient for me and did not seem worth the time required to keep working around the issue. I decided to stop building local defenses and give the existing evidence to the people upstream who actually had the code and could decide whether it deserved a fix.

Even the submission did not go smoothly. Codex tried several times to complete the support request through browser automation, but none of those attempts established a real conversation. In the end, I logged in myself, pasted the explanation, uploaded the PDF and supporting files, and checked that the accuracy statement had actually gone out with the message.

## Why achievement remained after AI did most of the work

Afterward, I said: “Even though AI did most of the work, I still felt a real sense of achievement.”

That feeling does not prove that “humans are irreplaceable.” Without AI, I probably would not have read the trace myself, let alone produced an English engineering report in so little time. Claiming that the main body of labor was mine would simply be a cheap new way to steal credit.

But ownership of an outcome does not seem to be calculated by labor volume alone.

I noticed a problem worth pursuing. I decided to capture evidence. I questioned whether the machine's hardware affected the diagnosis. I required the report to separate facts from hypotheses. And when automation failed, I personally carried the material across the final boundary. AI acted as analyst, technical writer, and operational assistant. It did not decide what level of evidence justified a conclusion, and it did not take responsibility for the embarrassment I might face if that conclusion turned out to be wrong after I sent it to someone else.

## What remains human when AI takes over execution

In the past, it was easy to tie achievement to doing something by hand: I wrote the code, drew the diagram, or composed the text, so the result was mine. Once AI breaks that relationship apart, a harder question remains. If much of the execution can be handed to a tool, what part of the work still belongs to the person?

For this case, at least, the answer is not that I mattered more than the AI. It is that I did not outsource the judgment along with the labor.

A tool can carry me a long way. It may travel faster and more professionally than I could. But someone still has to decide which problem is worth pursuing, where to stop, what must not be stated with certainty, and whether to put their name behind the result and send it out.

The satisfaction did not come from doing most of the work. It came from still taking part in the piece of the work that required responsibility, after most of the labor no longer required me at all.
