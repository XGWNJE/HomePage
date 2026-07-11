# 前端组件与视觉复用规范

目标：新增页面或功能时先查现有入口，再扩展 Props/variant；不要重新画近似组件、复制 SVG 或散落资产路径。

## 开发前的复用顺序

1. 查本文的组件地图。
2. 查 `src/data/visualAssets.ts`、`src/data/navLinks.ts`、`src/data/i18n.ts` 和 `src/consts.ts`。
3. 用 `rg` 搜索相似交互、类名、图标和资产。
4. 现有组件只差一个状态时，先增加 Prop 或 slot。
5. 只有职责不同且无法通过清晰 API 表达时，才新增组件。

## 组件地图

### 全站壳层

| 入口 | 职责 | 注意事项 |
| --- | --- | --- |
| `BaseHead.astro` | 元数据、全局 CSS、字体、主题、认证、i18n、光标、Reveal、Spotlight | 它不是单纯 `<head>`，普通页面不能漏掉 |
| `Header.astro` | 桌面导航、语言、RSS、主题、账号；挂载 Login/Settings 弹窗 | 不要再次单独挂载这两个弹窗 |
| `MobileDrawer.astro` | 移动导航 | 与 Header 成套使用 |
| `Footer.astro` | 页脚、联系入口、动态效果提示；挂载 ContactModal | 不要重复挂载 ContactModal |
| `BlogPost.astro` | 文章与内容页重布局、TOC、评论、灯箱、阅读进度 | 普通轻页面不要直接当通用 Layout |

普通页面目前仍重复手排壳层；后续应优先补一个轻量 `SiteLayout`，再新增普通页面。

### 内容展示

| 组件 | 用途 |
| --- | --- |
| `PageHeading.astro` | 列表页和二级页面标题 |
| `PostCard.astro` | 文章列表条目 |
| `TagBadges.astro` | 响应式标签与 `+N` |
| `FormattedDate.astro` | 日期格式 |
| `Pagination.astro` | 页码和 URL 规则 |
| `TerminalQuote.astro` | 首页终端打字卡；不要在 About 重新使用 |
| `CharacterDialogue.astro` | 桑多涅与站长对话；站长默认使用黑猫 |
| `Comment.astro` | 登录态评论和回复 |

### 目录与文章能力

- `Toc.astro`：纯目录树。
- `TocSidebar.astro`：桌面容器。
- `TocDrawer.astro`：移动抽屉。
- `Header showTocButton`、BlogPost 的 ID/data 属性和三个 TOC 组件属于同一契约，必须成套修改。

### 背景与动效

| 组件/类 | 用途 |
| --- | --- |
| `MeteorShower.astro` | 通用星轨背景 |
| `GoldenSpiral.astro` | About 几何背景 |
| `ParthenonColumns.astro` | 首页柱式装饰 |
| `.hero-enter/.section-enter/.card-enter` | 进入动效 |
| `.card-spotlight` | 指针聚光，需要 BaseHead 运行时 |
| `data-reveal` | 滚动显现，需要 reduced-motion 兼容 |

背景只能通过布局的 `background` slot 或具名背景组件加入，并保持 `aria-hidden`、`pointer-events:none`、明确 z-index 和减少动态效果降级。

## 已统一的视觉入口

- 页面宽度：`.page-shell`。
- 卡面：`.card-surface`、`.card-interactive`。
- 导航：`.nav-item`。
- 浮动 Chip：`.apple-float-chip` + `.apple-float-label`。
- 按钮和标签：`.apple-visit-button`、`.apple-meta-pill`、`.icon-button`。
- 表单：`.field-input`。
- 角色与备用资产：`src/data/visualAssets.ts`。
- 导航、语言和外部主页：`navLinks.ts`、`i18n.ts`、`consts.ts`。

## 当前重复与优先级

### P0：禁止继续扩大

- 不得在新文件中加入内联 UI SVG；品牌装饰组件除外。
- 不得在页面/组件中新增裸 `/image/sandrone/` 或 `/image/mascot/`。
- 不得复制 Blog 三视图切换器、弹窗外壳或文章卡。

### P1：下一次相关开发时收敛

1. 新增 `BlogViewTabs.astro`，替换 Blog、Important、Archive 和分页页的四份复制。
2. 新增轻量 `SiteLayout.astro`，收拢普通页面壳层。
3. 新增 `ModalShell.astro`，统一三个弹窗的遮罩、焦点、Escape 和滚动锁。
4. 建立 UI 图标集中入口；装饰 SVG 继续保留为具名组件。

### P2：样式系统

- 将品牌金、表面、阴影、圆角和玻璃透明度提升为语义 Token。
- 相关文章改为复用 PostCard/TagBadges 的紧凑 variant。
- Links 页的两套卡片收敛成一个项目卡组件。

## 图标规则

1. 先查现有组件和将来的统一图标入口。
2. UI 图标使用成熟图标库或集中组件，不在页面内手写 path。
3. `GoldenSpiral`、`ParthenonColumns` 等站点装饰不属于 UI 图标，可以保留专用实现。
4. 新的品牌装饰必须有具名组件和单一职责，不能散落匿名 SVG。

## 图片规则

1. 桑多涅和站长形象只能通过 `visualAssets.ts` 引用。
2. 新资产先登记用途、比例、裁切安全区和是否备用。
3. `references/visual/sandrone/` 只作为研究来源，不进入 `public/`，页面不得直接引用。
4. `CharacterDialogue` 头像依赖 `dialogue-avatar` 对文章图片全局样式的隔离，不能删除边框/阴影重置。
5. 删除图片前先 `rg` 查代码、内容、文档和 manifest。

## 自动检查

`npm run test:ui-reuse` 负责：

- manifest 中的本地图片必须存在。
- 桑多涅与黑猫路径只能出现在 manifest。
- 参考资料目录不得被页面或组件引用。
- 新增含内联 SVG 的 Astro 文件会失败，迫使开发者先复用图标入口。

该检查是源码契约，不代替浏览器视觉验收。普通前端迭代只验证受影响页面；明确要求全局 E2E 或准备发布时再升级完整验证。
