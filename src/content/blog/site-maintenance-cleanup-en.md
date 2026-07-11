---
title: "Making the Site Easier to Live With"
description: "This was not a visual overhaul. It was a quiet cleanup of repeated UI logic, oversized scripts, and the publishing path so writing a post no longer feels like a small release."
pubDate: 2026-07-12
updatedDate: 2026-07-12
lang: "en"
author: "XGWNJE"
group: "site-maintenance-cleanup"
tags: ["XGWNJE", "Site", "Engineering"]
important: true
importantOrder: 9
category: "Notes"
---

## This was not a reskin

The site may not look dramatically different today, but it has had a fairly deep cleanup underneath.

As more pages and features accumulated, the old habit of copying a little bit here and patching another copy there became tiring. A small change always came with the same question: is there another version of this somewhere that I have forgotten?

So the goal was not to make a flashier page. It was to make the site feel like a place worth maintaining for a long time.

## Repeated work should happen once

Regular pages now share one layout shell. The header, footer, common modals, and blog view switcher are reused instead of being rebuilt page by page.

That is not very dramatic, but it matters later. A change to navigation, theme behavior, language switching, or a modal no longer means hunting through several almost-identical copies. The pages still look like themselves; they are simply less of a guessing game to maintain.

## Let each script mind its own job

Some components used to hold a long mix of browser code: language controls, login state, table-of-contents highlighting, back-to-top behavior, code copying, image preview, and more. None of those features were wrong. They were just crowded together, which made their startup order and lifecycle hard to follow.

They are now separated by responsibility. The page provides structure, and each small runtime module owns one interaction. Fixing an article table of contents no longer risks touching login behavior by accident.

The server was cleaned up in the same spirit. Different API areas now live in their own route modules, while the application entry point only wires them together. The point is not to produce as many files as possible; it is to make the right starting point obvious when something needs attention.

## Publishing a post should not feel like a release day

The most useful change is a fast lane for article publishing.

When a change contains only posts and post-specific images, the publishing command checks the scope, bilingual pairing, image rules, and build. It then builds one complete static site and switches it atomically.

The full build is intentional. A post also changes the homepage, blog list, tags, RSS, and sitemap; replacing one HTML file would make those surfaces easy to desynchronize. The lighter part is everything that is not needed: no API deployment, no Nginx change, no complete backend audit, and no whole-site browser tour for an ordinary text update.

The daily routine is now simple: inspect the plan, push the article commit, then publish it. If a page, style, or backend change slips into the same diff, the command refuses to continue and points back to the normal release path. A post update should never quietly turn into shipping half the site.

## A little restraint stays useful

Lighter publishing does not mean disabling checks.

Changes to shared components, sign-in, databases, dependencies, or deployment code still move up to a full review. Those are the places where a mistake reaches far beyond one post. Keeping the heavy checks for the moments that need them is what makes ordinary publishing both faster and calmer.

## What I want from here

I want this site to be a place where I can write something when it is worth writing, without turning every post into a deployment ceremony. And when it is time for a bigger change, the process should still slow down and inspect the right things.

That is what this cleanup was really for. It is not the loudest kind of update, but it should save a lot of future friction.
