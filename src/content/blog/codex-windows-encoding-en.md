---
title: "I Removed One Codex Rule, and the Mojibake Came Back"
description: "How text corruption on Chinese Windows can escalate from a display problem into an AI agent data-loss path, and why encoding safeguards belong in global rules."
pubDate: 2026-07-17
updatedDate: 2026-07-17
lang: "en"
author: "XGWNJE"
group: "codex-windows-encoding"
tags: ["Codex", "AI Agent", "Windows", "PowerShell", "UTF-8"]
category: "Notes"
draft: false
---

I once refactored my global Codex rules.

The old rules contained several unglamorous restrictions: always specify UTF-8 when reading text on Windows; stop immediately when output contains mojibake or the Unicode replacement character `U+FFFD`; after modifying non-ASCII files, verify the encoding, BOM, replacement characters, and diff.

That section was lost during the refactor. The mojibake returned almost immediately.

This was not an isolated project failure. On a Chinese Windows system, the same class of problem can recur whenever an agent reads text through Windows PowerShell, a Python subprocess, or another command-line boundary. Sometimes the damage remains on screen. Sometimes the agent accepts the corrupted text as truth, reasons from it, and writes the result back into the repository.

For a person, mojibake may only be ugly. For an agent with write access, it can become a data-corruption pipeline.

![Three-layer data-flow diagram: blue represents valid UTF-8 data, amber represents a code-page mismatch, and a green safety gate blocks the red write-back path](/image/blog/codex-windows-encoding/encoding-defense-layers.webp)

*The three layers represent a valid read, an incorrect decode, and an agent read/write loop. The goal is not merely to make the terminal look correct. It is to stop corrupted text before it reaches a file write.*

## A UTF-8 console does not make the entire pipeline UTF-8

The machine was not obviously misconfigured:

```text
PowerShell       5.1 Desktop
Console Input    UTF-8 / CP65001
Console Output   UTF-8 / CP65001
.NET Default     GB2312 / CP936
PYTHONUTF8       1
PYTHONIOENCODING utf-8
```

Both console directions used UTF-8, while `.NET Default` still used the Simplified Chinese code page CP936. The failure lived in that gap.

Text handled by an agent does not travel directly from disk to screen. It may cross the filesystem, a PowerShell cmdlet, standard streams, a tool host, a Python subprocess, and finally the model context. One layer decoding the bytes incorrectly is enough to poison everything downstream.

```text
UTF-8 file
    ↓
PowerShell 5.1 decodes it as CP936
    ↓
Corrupted characters enter tool output
    ↓
The agent treats them as real content
    ↓
The agent analyzes, rewrites, and saves
    ↓
A display defect becomes file corruption
```

`chcp 65001`, a correct-looking terminal, and an editor status bar that says UTF-8 each prove only one layer. None of them guarantees how another process reads a BOM-less file.

## The same bytes can become different, apparently valid text

UTF-8, GBK, and Big5 answer the same underlying question: which characters should a sequence of bytes represent?

Suppose a UTF-8 file without a BOM contains:

```text
貝克街15號
```

Its bytes are:

```text
E8 B2 9D E5 85 8B E8 A1 97 31 35 E8 99 9F
```

If a program interprets those bytes through the active ANSI code page instead of UTF-8, the result may not be an exception. It may be another displayable Unicode string. That is the dangerous case: the tool does not crash, and the agent receives no reliable failure signal. It tries to understand the corrupted text, repairs what it thinks is broken, and may save its guess.

A public Codex issue documents an example in which the original `貝克街15號` was misread and the model ultimately reported `貝克街 5號`. The digit `1` disappeared and a space appeared. The failure had already moved beyond typography; information had changed.

An explicit `UnicodeDecodeError` is safer. It stops the process. Plausible mojibake lets the process continue with false confidence.

## PowerShell 5.1 defaults are built for this failure

Microsoft's PowerShell encoding documentation describes inconsistent defaults across Windows PowerShell 5.1:

- `Get-Content` reads a BOM-less file with the system ANSI code page by default.
- `Out-File`, `>`, and `>>` default to UTF-16LE.
- `Set-Content` and `Add-Content` can use the active system code page for a new file.
- Different cmdlets therefore make different encoding decisions without being asked.

PowerShell 6 and later generally changed text output to UTF-8 without a BOM. Windows PowerShell 5.1, however, remains the built-in and universally available Windows implementation. Compatibility-oriented agent tooling still falls back to it.

These commands differ by one parameter but not by one consequence:

```powershell
# Risky on Windows PowerShell 5.1: may decode with the ANSI code page
Get-Content -LiteralPath .\README.md

# Explicit: decode the file as UTF-8
Get-Content -LiteralPath .\README.md -Encoding UTF8
```

Writes require the same caution:

```powershell
# An agent should not use these on source files without proving the encoding
Get-Something > .\config.md
"new text" >> .\notes.md
Set-Content -LiteralPath .\data.md -Value $text

# Prefer a patch tool. If PowerShell must write, specify the encoding.
```

Console input and output settings do not redefine how `Get-Content` decodes file bytes. Fixing the visible console can leave the file-read side untouched.

## Codex has received repeated reports of the same class of bug

This is not an attempt to blame every local configuration failure on a model.

The public OpenAI Codex repository contains several related Windows encoding reports:

- Chinese PowerShell output becomes mojibake when it passes through `codex-app-server`.
- A Codex child process can fall back to CP936 even when PowerShell 7, VS Code, and the terminal are configured for UTF-8.
- Windows PowerShell 5.1 reads a UTF-8 file without a BOM through the default code page, after which the model confidently reasons from the corrupted result.
- Some mitigations fix console output without fixing the `Get-Content` read path.

One experimental mitigation exposed a `powershell_utf8` feature. Later reports made the remaining gap clear: assigning console `InputEncoding` and `OutputEncoding` can repair standard streams while leaving a cmdlet's default file decoding unchanged.

This explains why the bug can survive an environment that appears to be “UTF-8 everywhere.” The checks usually cover the editor and visible terminal. They may not cover which shell the agent spawned, whether it loaded a profile, which defaults its cmdlets used, or what happened inside a redirected subprocess.

## Regional support is context, not a proven cause

OpenAI's current API-supported-country list does not include mainland China. OpenAI also states that accessing ChatGPT or the API from an unsupported country or territory may lead to an account being blocked or suspended.

That creates an operational reality: many Chinese-language environments fall outside the officially supported service boundary and may not be primary validation targets.

It does not prove that the regional policy caused the Windows encoding defect. Public evidence establishes two separate facts—the service boundary and the existence of Chinese Windows encoding bugs—not a causal relationship between them.

The defensible conclusion is narrower:

> A common environment among Chinese users may sit near the edge of product test coverage. Whatever the reason, users cannot delegate encoding safety to tool defaults.

## The defense needs two layers

Environment changes cannot constrain every command an agent generates. A written rule cannot repair every subprocess. I therefore keep two layers.

### Layer one: stabilize tool runtimes

Python subprocesses explicitly use UTF-8:

```powershell
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
```

This protects Python tools from silently falling back to a local code page. It does not change Windows PowerShell 5.1, and it does not govern every third-party executable.

I did not enable Windows' “Beta: Use Unicode UTF-8 for worldwide language support” system locale option. It changes the machine-wide code page and can break older applications that depend on legacy behavior. A local, reviewable defense has a smaller blast radius and a clearer rollback path.

### Layer two: make suspicious text a stop condition

The restored global rules are executable constraints rather than a vague reminder to “be careful with encoding”:

```text
1. Treat Windows text files as UTF-8 without a BOM unless the project says otherwise.
2. Prefer rg or an explicitly UTF-8 reader for non-ASCII files.
3. Require -Encoding UTF8 when using Get-Content.
4. Prefer apply_patch for text edits.
5. Do not use implicit >, >>, Out-File, Set-Content, or Add-Content on source files.
6. Stop reasoning and writing when output contains U+FFFD, mojibake, or implausible text.
7. Inspect raw bytes and cross-check with another reader.
8. After writing, verify UTF-8, BOM status, replacement characters, and the diff.
```

The sixth rule matters most: **suspicious input must stop the workflow.**

The most dangerous automation failure is not an explicit error. It is a successful operation based on false input. An agent's language ability amplifies that failure because it can explain, complete, and polish characters that should never have been trusted.

## A minimal incident check

Do not immediately rewrite a file that appears corrupted. Run three checks first.

### 1. Inspect the bytes

```powershell
Format-Hex -LiteralPath .\README.md | Select-Object -First 8
```

This shows what the file contains rather than how a terminal rendered it. A UTF-8 BOM is `EF BB BF`; the absence of a BOM does not mean the file is not UTF-8.

### 2. Read it explicitly as UTF-8

```powershell
Get-Content -LiteralPath .\README.md -Encoding UTF8
```

If the explicit read is correct and the default read is not, the file is not the primary failure. The decode path is.

### 3. Check writes for replacement characters and unexpected changes

```powershell
# Search for U+FFFD without embedding it in this script
rg -n ([char]0xFFFD) .
git diff --check
git diff -- .\README.md
```

`U+FFFD` is a strong stop signal, but it is not the only one. Incorrect byte sequences can still map to valid characters without producing a replacement character. Review punctuation, digits, paths, and configuration values manually.

If a file has already been overwritten, restore its bytes from version control, a backup, or another trusted source. Do not ask a model to reconstruct lost text from mojibake. The missing information may be unrecoverable.

## Safety rules are easy to delete because they are not elegant

Global-rule refactors aim for brevity, clarity, and less repetition. Platform-specific encoding constraints look like implementation noise that the tool ought to handle internally.

Some rules, however, are incident-derived fuses. Their value is not literary. Before removing one, record which failure it prevented, what happens without it, and whether a lower layer has genuinely replaced it.

Use a regression checklist:

| Check | Question |
| --- | --- |
| Incident | Which real failure originally created this rule? |
| Environment | Is the failure specific to an OS, locale, shell, or version? |
| Replacement | Has the toolchain fixed the whole path or only one visible layer? |
| Failure mode | Does it stop with an error or silently return incorrect content? |
| Impact | Does it affect display only, or can it reach files and releases? |
| Verification | Can a minimal reproduction prove that removing the rule is safe? |

Deleting a safety rule without answering these questions simply reintroduces a known fault.

## Protect the read/write loop, not the terminal screenshot

Encoding bugs are often treated as environment trivia because they first appear as unreadable text. In an agent workflow, reading and writing can occur without a person checking each boundary. A tool reads a file, the model generates a patch, another process saves it, and a release step publishes the result.

The safety standard therefore has to cover the entire loop:

- file bytes are decoded with the intended encoding;
- subprocesses and pipes do not silently transform the text;
- suspicious input stops reasoning;
- writes use an explicit and verifiable encoding;
- post-write checks inspect replacement characters, BOM state, and the diff;
- published content can be compared with a trusted source.

The mojibake returned as soon as I removed the rule. That was useful evidence. The rule had not repaired Windows' encoding history; it had installed a gate at a point the toolchain still did not reliably protect.

---

## Sources

- Microsoft Learn: [about_Character_Encoding](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_character_encoding)
- Python documentation: [Environment variables and UTF-8 mode](https://docs.python.org/3/using/cmdline.html#environment-variables)
- OpenAI Help Center: [API supported countries and territories](https://help.openai.com/en/articles/5347006)
- OpenAI Help Center: [Access from unsupported countries and territories](https://help.openai.com/en/articles/9131992)
- OpenAI Codex issue: [PowerShell Chinese output mojibake #4498](https://github.com/openai/codex/issues/4498)
- OpenAI Codex issue: [Non-Latin characters remain corrupted in a UTF-8 environment #7290](https://github.com/openai/codex/issues/7290)
- OpenAI Codex issue: [PowerShell 5.1 misreads BOM-less UTF-8 files #23044](https://github.com/openai/codex/issues/23044)

> The machine configuration, rule change, and recurrence described here come from a real working environment. Project names, usernames, absolute paths, and unrelated details have been removed. Public issues demonstrate that similar failures exist; they do not imply that every root-cause claim in those discussions has been officially confirmed by OpenAI.
