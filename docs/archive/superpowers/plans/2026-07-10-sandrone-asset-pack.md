# Sandrone Mixed Asset Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, validate, and save five website-ready Sandrone assets that preserve the current official character design while supporting the site's assistant, observer, indexing, maintenance, and article-dialog roles.

**Architecture:** Use the built-in image generation path with three official reference images. Generate scene illustrations directly, generate utility characters on a flat chroma-key background, remove that background locally, and validate identity, composition, file dimensions, and alpha coverage before saving under one project asset directory.

**Tech Stack:** Built-in image generation, local image inspection, Python/Pillow chroma-key helper, Astro public assets.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-10-sandrone-asset-pack-design.md` exactly.
- Preserve Sandrone's official face, ash-brown hair, blue eyes, white mechanical headpiece, black/white/red outfit, gold framework, and cyan mechanical details.
- Do not add text, logos, watermarks, extra characters, animal ears, modern devices, alternate outfits, romance, or official-endorsement cues.
- Generate each asset separately; do not crop a single contact sheet into multiple files.
- Save final project assets under `public/image/sandrone/` without overwriting existing files.
- Do not modify page code, commit, push, or deploy during this plan.

---

### Task 1: Prepare References and Output Boundary

**Files:**
- Reference: `%TEMP%/homepage-sandrone-research/notes-0.jpg`
- Reference: `%TEMP%/homepage-sandrone-research/profile-2.jpg`
- Reference: `%TEMP%/homepage-sandrone-research/profile-0.jpg`
- Create directory: `public/image/sandrone/`

**Interfaces:**
- Consumes: three inspected official reference images.
- Produces: stable output directory and a reference set for all later generation tasks.

- [ ] **Step 1: Verify all references exist and are non-empty**

Run:

```powershell
$refs = @(
  "$env:TEMP\homepage-sandrone-research\notes-0.jpg",
  "$env:TEMP\homepage-sandrone-research\profile-2.jpg",
  "$env:TEMP\homepage-sandrone-research\profile-0.jpg"
)
$refs | ForEach-Object { Get-Item -LiteralPath $_ | Select-Object FullName, Length }
```

Expected: three files, each with `Length` greater than zero.

- [ ] **Step 2: Create the output directory without deleting anything**

Run:

```powershell
New-Item -ItemType Directory -Force -Path public/image/sandrone | Out-Null
```

Expected: `public/image/sandrone/` exists and existing assets remain untouched.

### Task 2: Generate Homepage Guide Scene

**Files:**
- Create: `public/image/sandrone/hero-guide-v1.webp`

**Interfaces:**
- Consumes: official mood, full-costume, and face references.
- Produces: 16:9 scene illustration with a left-side copy-safe area.

- [ ] **Step 1: Generate the homepage source image**

Use this prompt with all three references:

```text
Use case: identity-preserve
Asset type: personal website homepage hero illustration
Input images: Image 1 is the official mood and palette reference; Image 2 is the authoritative full costume and proportion reference; Image 3 is the authoritative face and upper-body reference.
Primary request: create a new scene featuring the exact same current official Sandrone character as the references, acting as a calm website guide and observer.
Scene/backdrop: elegant dark archive room merged with a precise mechanical workbench, restrained gears, indexing mechanisms, warm paper surfaces, faint cyan status lights.
Subject: Sandrone stands on the right side in a restrained three-quarter-body pose, one hand raised slightly to guide a visitor toward the empty content area, the other near a small mechanical record device or teacup.
Style/medium: polished official-quality 2D anime game key art, matching the rendering language of the references.
Composition/framing: 16:9 landscape, character contained within the right 40 percent, clean low-detail negative space across the left 50 percent, no important element touching crop edges.
Lighting/mood: calm warm-white ambient light with subtle icy cyan mechanical light; rational, precise, quietly protective.
Color palette: charcoal black, deep red, warm ivory, antique gold, restrained icy cyan.
Constraints: preserve her exact face, blue eyes, ash-brown hairstyle and bangs, white mechanical headpiece, black neck structure, official black-white-red layered dress, gloves, gold framework, cyan mechanical details, red ribbons, body proportions, and personality. No text, logo, signature, watermark, extra person, animal ears, glasses, modern device, alternate outfit, romantic pose, cute idol pose, or official endorsement. Do not redesign the character.
```

- [ ] **Step 2: Inspect identity and layout**

Expected: unmistakably Sandrone; intact hands and costume; clean left-side text zone; no text or extra characters.

- [ ] **Step 3: Save the selected result**

Copy the generated source into `public/image/sandrone/hero-guide-v1.webp`, converting only the file format when needed and preserving the original aspect ratio.

### Task 3: Generate About Observer Scene

**Files:**
- Create: `public/image/sandrone/about-observer-v1.webp`

**Interfaces:**
- Consumes: the same reference set and character invariants.
- Produces: 4:5 observer illustration suitable for desktop and mobile About layouts.

- [ ] **Step 1: Generate the About source image**

Use this prompt with all three references:

```text
Use case: identity-preserve
Asset type: About page character illustration
Input images: Image 1 is the official mood and palette reference; Image 2 is the authoritative full costume and proportion reference; Image 3 is the authoritative face and upper-body reference.
Primary request: create a new scene with the exact same current official Sandrone character observing and organizing the webmaster's archive.
Scene/backdrop: a refined tea table joined to a compact mechanical records desk, paper index cards, diagrams without readable writing, dark machinery, warm ivory paper, restrained cyan indicators.
Subject: Sandrone sits naturally beside the table, sorting a small stack of records or mechanical index cards, body angled toward the future article text area and eyes turned slightly toward the visitor.
Style/medium: polished official-quality 2D anime game illustration matching the references.
Composition/framing: 4:5 portrait, full upper body and major costume structure visible, comfortable margin around headpiece and ribbons, clear adjacent negative space for layout.
Lighting/mood: observant and mildly critical but actively helping; warm-white key light plus subtle cyan mechanical rim light.
Color palette: deep red, charcoal, warm ivory, antique gold, icy cyan.
Constraints: preserve exact official identity, face, blue eyes, hairstyle, headpiece, costume construction, gloves, ribbons, gold and cyan mechanical elements, and normal proportions. No readable text, logo, watermark, extra character, alternate clothing, exaggerated smile, romance, servant pose, or redesign.
```

- [ ] **Step 2: Inspect identity, hands, desk interaction, and portrait crop**

Expected: recognizable face and outfit, natural seated anatomy, no extra fingers, no text, usable portrait safe area.

- [ ] **Step 3: Save the selected result**

Save as `public/image/sandrone/about-observer-v1.webp` without stretching.

### Task 4: Generate and Extract Index Assistant

**Files:**
- Create source: `public/image/sandrone/index-assistant-v1-key.png`
- Create final: `public/image/sandrone/index-assistant-v1.webp`

**Interfaces:**
- Consumes: official character reference set.
- Produces: transparent full/three-quarter-body indexing assistant.

- [ ] **Step 1: Generate a flat-key source**

Use this prompt with all three references:

```text
Use case: background-extraction
Asset type: website content-index assistant cutout
Input images: Image 1 is the official mood and palette reference; Image 2 is the authoritative full costume and proportion reference; Image 3 is the authoritative face reference.
Primary request: the exact same current official Sandrone character checking and organizing a content index.
Subject: isolated three-quarter-body Sandrone, left hand holding a compact mechanical record board with no writing, right hand adjusting one small floating index pointer; focused restrained expression.
Style/medium: polished official-quality 2D anime game character illustration matching the references.
Composition/framing: centered within a square canvas, complete silhouette, generous padding around headpiece, ribbons, hands, and costume.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local removal.
Constraints: preserve exact official face, hair, blue eyes, white mechanical headpiece, official black-white-red costume, gold and cyan mechanical details, body proportions, and personality. Background must be one uniform #00ff00 with no shadows, gradient, texture, reflection, floor, or lighting variation. No #00ff00 in the character. No text, logo, watermark, extra character, animal ears, alternate outfit, or redesign.
```

- [ ] **Step 2: Remove the chroma-key background**

Run:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\imagegen\scripts\remove_chroma_key.py" --input public/image/sandrone/index-assistant-v1-key.png --out public/image/sandrone/index-assistant-v1-alpha.png --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
```

Expected: an alpha intermediate with transparent corners and no obvious green fringe. Convert it to lossless Alpha WebP at `public/image/sandrone/index-assistant-v1.webp`, validate transparency, then remove the intermediate.

- [ ] **Step 3: Validate alpha and edges**

Inspect at full size and at 160 px display size. Retry once with `--edge-contract 1` only if green fringe remains.

### Task 5: Generate and Extract Maintenance Assistant

**Files:**
- Create source: `public/image/sandrone/maintenance-assistant-v1-key.png`
- Create final: `public/image/sandrone/maintenance-assistant-v1.webp`

**Interfaces:**
- Consumes: official reference set.
- Produces: transparent maintenance/error-state assistant.

- [ ] **Step 1: Generate a flat-key source**

Use this prompt with all three references:

```text
Use case: background-extraction
Asset type: website error and maintenance-state assistant cutout
Input images: Image 1 is the official mood reference; Image 2 is the authoritative full costume reference; Image 3 is the authoritative face reference.
Primary request: the exact same current official Sandrone character calmly repairing one misaligned precision gear module.
Subject: isolated three-quarter-body Sandrone, one hand stabilizing a compact gear mechanism and the other making a precise adjustment; mildly impatient expression but reliable controlled action.
Style/medium: polished official-quality 2D anime game character illustration matching the references.
Composition/framing: centered square canvas, complete silhouette and generous padding, mechanism does not obscure face or core costume details.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local removal.
Constraints: preserve exact identity, blue eyes, ash-brown hair, headpiece, official layered outfit, gloves, ribbons, gold and cyan mechanics, normal proportions, and restrained personality. Uniform #00ff00 background only, no shadow, gradient, texture, floor, or reflection; do not use #00ff00 in the subject. No text, logo, watermark, extra character, comedy fall, rage, alternate outfit, modern tool, or redesign.
```

- [ ] **Step 2: Remove the chroma-key background**

Run the same helper and lossless Alpha WebP conversion as Task 4 with the maintenance filenames.

- [ ] **Step 3: Validate alpha, hands, mechanism, and small-state readability**

Expected: transparent corners, clean hair/headpiece edges, valid hand anatomy, clear expression at 160–240 px.

### Task 6: Generate and Extract Dialog Chibi

**Files:**
- Create source: `public/image/sandrone/dialog-chibi-v1-key.png`
- Create final: `public/image/sandrone/dialog-chibi-v1.webp`

**Interfaces:**
- Consumes: official reference set with explicit chibi proportion transformation.
- Produces: transparent chibi dialog decoration readable at 80–160 px.

- [ ] **Step 1: Generate a flat-key chibi source**

Use this prompt with all three references:

```text
Use case: background-extraction
Asset type: article dialog-box chibi decoration
Input images: Image 1 is the official mood reference; Image 2 is the authoritative full costume reference; Image 3 is the authoritative face reference.
Primary request: create a 2.5-head-tall chibi version of the exact same current official Sandrone, designed as a compact article dialog decoration.
Subject: isolated chibi Sandrone holding a small blank mechanical record board against her chest, the other hand resting on or lightly tapping its edge; calm scrutinizing expression with a trace of restrained exasperation.
Style/medium: polished clean 2D anime chibi illustration derived from the official rendering, crisp silhouette and readable details at small size.
Composition/framing: centered square canvas, compact full-body silhouette, generous padding, no cropped headpiece or ribbons.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local removal.
Constraints: simplify tiny patterns only; preserve recognizable blue eyes, official hairstyle, white mechanical headpiece, black-white-red clothing, gold and cyan mechanisms, red ribbons, and character personality. Uniform #00ff00 background only; no shadows, gradients, texture, floor, or reflection; no #00ff00 in the subject. No text, logo, watermark, extra character, animal ears, open-mouth cute smile, heart symbols, romance, alternate outfit, or redesign.
```

- [ ] **Step 2: Remove the chroma-key background**

Run the same helper and lossless Alpha WebP conversion as Task 4 with the chibi filenames.

- [ ] **Step 3: Validate small-size recognition**

Expected: immediately recognizable at 80, 120, and 160 px; clean alpha; no lost headpiece or costume identity.

### Task 7: Cross-Asset Review

**Files:**
- Inspect: `public/image/sandrone/hero-guide-v1.webp`
- Inspect: `public/image/sandrone/about-observer-v1.webp`
- Inspect: `public/image/sandrone/index-assistant-v1.webp`
- Inspect: `public/image/sandrone/maintenance-assistant-v1.webp`
- Inspect: `public/image/sandrone/dialog-chibi-v1.webp`

**Interfaces:**
- Consumes: all five generated deliverables.
- Produces: one internally consistent, project-ready asset pack.

- [ ] **Step 1: Check file inventory and dimensions**

Run a local image metadata check and confirm five final files exist, are non-empty, and have plausible dimensions.

- [ ] **Step 2: Compare all five assets together**

Expected: same face, hair, headpiece, costume, palette, and line/render language across assets; no unintended design drift.

- [ ] **Step 3: Check transparency and crop safety**

Expected: transparent corners on all three PNG cutouts; hero and About retain required negative space; no important feature touches an unsafe crop edge.

- [ ] **Step 4: Confirm repository scope**

Run:

```powershell
git status --short
```

Expected: only the approved design/plan documents and `public/image/sandrone/` assets are new; no page code, unrelated files, commit, push, or deployment changes.
