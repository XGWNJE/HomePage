---
title: "我删掉了一条 Codex 规则，乱码就回来了"
description: "中文 Windows 上，乱码如何从显示问题升级成 Agent 数据破坏，以及为什么编码防御必须进入全局规则。"
pubDate: 2026-07-17
updatedDate: 2026-07-17
lang: "cn"
author: "XGWNJE"
group: "codex-windows-encoding"
tags: ["Codex", "AI Agent", "Windows", "PowerShell", "UTF-8"]
category: "Notes"
draft: false
---

我重构过一次 Codex 的全局规则。

原来的规则里有一组看似琐碎的限制：Windows 上读文本必须显式指定 UTF-8；遇到乱码或 Unicode 替换字符 `U+FFFD`，立即停止推理和写回；修改中文文件后，还要检查编码、BOM 和差异。

重构时，这组规则被漏掉了。乱码随即重新出现。

这不是偶发故障。在中文 Windows 环境里，只要 Agent 经过 PowerShell、Python 子进程或其他命令行工具读取文本，同一类问题几乎可以在每个项目里复现。区别只在于：有时乱码停留在终端里，有时它会被 Agent 当成真实内容，继续分析，最后写回源码。

对人而言，乱码可能只是难看；对拥有文件写入权限的 Agent 而言，乱码是一条数据破坏链。

![三层数据通道示意图：蓝色表示正常 UTF-8 数据，橙色表示错误代码页解码，红色写回路径被绿色安全门拦截](/image/blog/codex-windows-encoding/encoding-defense-layers.webp)

*图中三层依次表示正常读取、错误解码和 Agent 读写循环。防御的目标不是让终端看起来正常，而是在错误内容写回文件前中断链路。*

## 控制台是 UTF-8，不代表整条链路是 UTF-8

这台机器当时的状态并不落后：

```text
PowerShell       5.1 Desktop
Console Input    UTF-8 / CP65001
Console Output   UTF-8 / CP65001
.NET Default     GB2312 / CP936
PYTHONUTF8       1
PYTHONIOENCODING utf-8
```

输入和输出都是 UTF-8，但 `.NET Default` 仍是简体中文代码页 CP936。问题就藏在这条缝里。

文本经过 Agent 时，不只经过屏幕。它可能依次穿过文件系统、PowerShell cmdlet、标准输入输出、工具宿主、Python 子进程和模型上下文。只要其中一层用错误的编码解释字节，后面接收到的就不再是原文。

```text
UTF-8 文件
    ↓
PowerShell 5.1 按 CP936 读取
    ↓
错误字符进入工具输出
    ↓
Agent 把错误字符当成真实内容
    ↓
分析、改写、保存
    ↓
损坏从显示层进入文件层
```

因此，`chcp 65001`、终端显示正常或编辑器标注 UTF-8，都不足以证明整条链路安全。它们只能说明某一层的配置，不能替其他进程作保证。

## 同一组字节，可以变成另一段“合法文字”

UTF-8、GBK、Big5 等编码，本质上都在回答同一个问题：一组字节应该对应什么字符。

假设一个 UTF-8 无 BOM 文件包含：

```text
貝克街15號
```

它的十六进制字节是：

```text
E8 B2 9D E5 85 8B E8 A1 97 31 35 E8 99 9F
```

如果读取程序没有按 UTF-8 解码，而是把这些字节交给当前系统的 ANSI 代码页，得到的可能不是异常，而是另一串仍可显示的字符。危险之处正在这里：程序没有崩溃，Agent 也未必看到明确错误。它拿到一段貌似有效的 Unicode 字符串，于是尝试理解它、修复它，甚至把自己的猜测写回文件。

Codex 的公开 Issue 中已有高度吻合的案例：原文 `貝克街15號` 被错误读取后，模型最终回答成 `貝克街 5號`。数字 `1` 消失，还多出一个空格。问题不再是“字不好看”，而是信息已经变化。

这类错误比直接抛出 `UnicodeDecodeError` 更难处理。异常会迫使流程停止；貌似合法的乱码则会让流程带着错误继续前进。

## PowerShell 5.1 的默认行为正好踩中这个坑

微软的 PowerShell 编码文档明确列出了版本差异。

在 Windows PowerShell 5.1 中：

- 无 BOM 文件被 `Get-Content` 读取时，默认使用系统 ANSI 代码页；
- `Out-File` 以及 `>`、`>>` 默认写出 UTF-16LE；
- `Set-Content` 和 `Add-Content` 在新文件上又可能使用系统默认代码页；
- 不同 cmdlet 的默认编码并不一致。

PowerShell 6 及以上版本才把文本输出普遍统一到 UTF-8 无 BOM。可 Windows 仍自带并广泛使用 Windows PowerShell 5.1。Agent 为了兼容系统，经常会落到这条旧链路上。

下面两条命令看起来只差一个参数，含义却完全不同：

```powershell
# 风险写法：在 PowerShell 5.1 中可能按系统 ANSI 代码页读取
Get-Content -LiteralPath .\README.md

# 明确写法：告诉读取层文件应按 UTF-8 解码
Get-Content -LiteralPath .\README.md -Encoding UTF8
```

写入同样不能依赖默认值：

```powershell
# 不应让 Agent 在不确认编码时使用这些写法修改源码
Get-Something > .\config.md
"追加内容" >> .\notes.md
Set-Content -LiteralPath .\data.md -Value $text

# 更稳妥的原则不是记住每个版本的全部默认值，
# 而是优先使用补丁工具；必须使用 PowerShell 时显式声明编码。
```

这也是为什么“终端已经改成 UTF-8”仍不能解决全部问题：控制台输入输出编码，不会自动改变 `Get-Content` 解释文件字节的方式。

## Codex 确实长期存在同类报告

这不是把一个本地配置问题强行归咎于模型。

OpenAI 的 Codex 仓库中，至少可以找到几类相互关联的 Windows 编码报告：

- PowerShell 输出经过 `codex-app-server` 后出现中文乱码；
- 即使 PowerShell 7、VS Code 和终端都设为 UTF-8，Codex 子进程仍可能退回 CP936；
- Windows PowerShell 5.1 用默认代码页读取 UTF-8 无 BOM 文件，模型收到错误内容后继续回答；
- 部分修复只处理控制台输出，没有覆盖 `Get-Content` 的文件读取侧。

其中一项实验性修复曾要求启用 `powershell_utf8` 特性。但后续报告表明，只设置控制台的 `InputEncoding` 和 `OutputEncoding` 仍不完整：它能修复标准输出，却未必改变 PowerShell cmdlet 对文件的默认解码。

这解释了一个常见误判：环境已经“全是 UTF-8”，问题为何仍会复发？因为所谓“全是”，往往只检查了可见的终端和编辑器，没有检查 Agent 实际启动了哪个 shell、是否加载 profile、文件读取 cmdlet 使用什么默认值，以及子进程如何处理管道。

## 地区支持是背景，不是已经证明的根因

OpenAI 当前公布的 API 支持地区列表不包含中国大陆。官方同时说明，从未支持的国家或地区访问 ChatGPT 或 API，可能导致账号被封禁或暂停。

这意味着一个现实：大量中文用户的使用环境并不属于官方承诺的服务范围，中文 Windows 场景也未必是最优先的验证对象。

但文章不能越过证据。公开资料能证明“官方不支持中国大陆”和“Codex 存在中文 Windows 编码缺陷”，不能证明后者由前者直接造成。把两件事写成确定因果，只会削弱文章可信度。

更准确的判断是：

> 中文用户常见的本地环境组合，可能处在产品测试覆盖的边缘；无论原因是什么，使用者都不能把编码安全完全交给工具默认值。

## 我最终保留了两层防御

单独修改环境，不能约束 Agent 的每一次命令；单独写一条提示，也不能修复所有子进程。因此防御分成两层。

### 第一层：稳定工具环境

Python 子进程显式使用 UTF-8：

```powershell
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
```

这一层解决的是 Python 工具读取 UTF-8 文件时退回本地代码页的问题。但它只影响 Python，不会自动改变 PowerShell 5.1，也不会替所有第三方程序选择编码。

我没有启用 Windows 的“Beta：使用 Unicode UTF-8 提供全球语言支持”。这个开关会改变整台机器的系统代码页，可能让依赖旧代码页的软件出现兼容问题。为了修复 Agent 工作流而改变所有旧程序的运行条件，作用范围过大，也不利于回滚和定位。

### 第二层：把停止条件写进 Agent 规则

最终恢复的规则不是一句“注意编码”，而是一组可执行约束：

```text
1. Windows 文本文件默认按 UTF-8 无 BOM 处理。
2. 读取非 ASCII 文件时，优先使用 rg 或显式 UTF-8 读取。
3. 使用 Get-Content 时必须指定 -Encoding UTF8。
4. 修改文本优先使用 apply_patch。
5. 禁止用未指定编码的 >、>>、Out-File、Set-Content、Add-Content 写源码。
6. 一旦出现 U+FFFD、明显乱码或上下文异常，立即停止推理和写回。
7. 先检查原始字节，再换一种读取方式交叉验证。
8. 写入后验证 UTF-8、BOM、替换字符和 diff。
```

关键不是“统一编码”，而是第六条：**遇到可疑内容时停止。**

自动化系统最危险的状态不是失败，而是带着错误继续成功。只要 Agent 仍把乱码当成输入，它的语言能力反而会扩大问题：它会补全、解释和润色原本不该被相信的字符。

## 一套可以直接执行的最小检查

怀疑文件被错误读取时，不要立即重写。先完成三项检查。

### 1. 检查文件头和原始字节

```powershell
Format-Hex -LiteralPath .\README.md | Select-Object -First 8
```

这一步确认文件实际保存了什么，而不是终端把它显示成什么。UTF-8 BOM 是 `EF BB BF`；没有 BOM 不等于不是 UTF-8。

### 2. 用显式 UTF-8 重新读取

```powershell
Get-Content -LiteralPath .\README.md -Encoding UTF8
```

如果显式 UTF-8 读取正常，而默认读取异常，问题在解码链路，不在文件内容。

### 3. 写入后检查替换字符与差异

```powershell
# 搜索 Unicode 替换字符 U+FFFD，不把该字符本身写进脚本
rg -n ([char]0xFFFD) .
git diff --check
git diff -- .\README.md
```

`U+FFFD` 是解码器在无法还原字符时放入的替换符。它是强烈的停止信号，但不是唯一信号：有些错误字节仍能映射为合法汉字，不会产生替换字符。因此还必须人工审查差异，特别关注中文标点、数字、路径和配置值。

如果文件已经被写坏，应从版本控制、备份或可信来源恢复原始字节，而不是让模型根据乱码猜回原文。乱码丢失的信息通常无法可靠逆推。

## 规则重构最容易删掉的，正是这些“不漂亮”的东西

全局规则重构通常追求更短、更清晰、更少重复。编码限制看上去像平台细节，容易被归入“工具应该自己处理”的噪声。

但有些规则不是表达偏好，而是事故留下的保险丝。它们不应该仅按文字是否优雅来判断去留，而应该附带来源：防过什么故障，移除后会产生什么后果，是否已有更底层的机制替代。

这次复发给出的结论很直接：

> 如果一条规则曾阻止数据损坏，它就不是提示词装饰，而是运行时安全控制。

重构这类规则前，应先做回归清单：

| 检查项 | 要回答的问题 |
| --- | --- |
| 故障来源 | 这条规则最初防过什么真实问题？ |
| 适用环境 | 问题是否只在特定系统、语言或工具版本出现？ |
| 底层替代 | 工具链是否已经可靠修复，而非只修了一个表面？ |
| 失败方式 | 失败会明确报错，还是静默产生错误内容？ |
| 影响范围 | 错误只影响显示，还是可能进入文件、数据库或发布物？ |
| 验证方法 | 删除规则后，能否用最小复现实验证明安全？ |

没有完成这张表，删掉安全规则只是把已知风险重新放回系统。

## 真正要保护的是读写闭环

编码问题常被当作环境配置杂务，因为它通常先以乱码出现。但在 Agent 工作流里，读取和写入不再由同一个人逐步确认。工具读完以后，模型可以立刻生成补丁、改配置、整理文档，再把结果交给下一个自动化步骤。

因此，安全标准不能停在“中文能显示”：

- 读取时，字节必须按预期编码解释；
- 传递时，子进程和管道不能静默转换；
- 推理前，可疑文本必须触发停止；
- 写入时，编码必须明确且可验证；
- 写入后，必须检查替换字符、BOM 和差异；
- 发布前，内容应能从可信来源复核。

我删掉规则后，乱码回来得很快。这件事反而证明了规则的价值：它不是治好了 Windows 的编码历史，而是在一个尚未被工具彻底修复的地方，给 Agent 加了一道不能凭自信跨过去的门。

---

## 资料来源

- Microsoft Learn：[about_Character_Encoding](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_character_encoding)
- Python 文档：[环境变量与 UTF-8 模式](https://docs.python.org/3/using/cmdline.html#environment-variables)
- OpenAI Help Center：[API 支持的国家和地区](https://help.openai.com/en/articles/5347006)
- OpenAI Help Center：[未支持国家和地区的访问说明](https://help.openai.com/en/articles/9131992)
- OpenAI Codex Issue：[PowerShell 中文输出乱码 #4498](https://github.com/openai/codex/issues/4498)
- OpenAI Codex Issue：[UTF-8 环境中仍出现非拉丁字符乱码 #7290](https://github.com/openai/codex/issues/7290)
- OpenAI Codex Issue：[PowerShell 5.1 默认代码页导致 UTF-8 文件误读 #23044](https://github.com/openai/codex/issues/23044)

> 文中的本机配置、规则变化和复发现象来自实际工作环境；项目名、用户名、绝对路径及无关内容已省略。公开 Issue 用于证明同类问题存在，不代表其中的全部根因分析都已得到 OpenAI 官方确认。
