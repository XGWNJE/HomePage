# Clash 订阅管理员面板实现规范

- 状态：阶段 1–3 已完成；阶段 4 正在执行生产发布与真实浏览器验收
- 日期：2026-07-15
- 提供方：`D:\ObjectCode\vps-proxies`
- 消费方：`D:\ObjectCode\HomePage`

## 目标

在 HomePage 管理后台增加独立的 Clash 订阅板块。站长或被授予 `manage_subscriptions` 权限的管理员可以按需复制桌面、移动和 CMFA 导入链接，或查看移动端导入二维码。普通访客、普通登录用户和没有该细粒度权限的管理员不能获得秘密，也不能从 API 行为判断该能力是否启用。

当前 Windows 本机面板继续保留为维护回退入口，不部署、不 iframe、不反向代理到公网。线上页面必须使用 HomePage 原生组件和 Token 重做，让主题、暗色模式、响应式与站点后续样式变化自然同步。

## 上游握手

实现前必须完整读取：

- `D:\ObjectCode\vps-proxies\docs\integrations\homepage-admin-subscriptions.md`
- `D:\ObjectCode\vps-proxies\contracts\homepage-subscription-access.v1.schema.json`
- `D:\ObjectCode\vps-proxies\contracts\fixtures\homepage-subscription-access.v1.example.json`

本仓库的 `server/test/fixtures/subscription-access.v1.json` 是 v1 消费方夹具，内容必须与上游 example fixture 完全一致。真实 URL、二维码和注册表禁止进入本仓库。

## 已知现状与安全门槛

- HomePage 是 Astro 静态前端，管理 API 位于 `server/`。
- `src/pages/admin/index.astro` 已提供管理后台入口。
- `src/lib/admin.ts` 当前使用 Bearer token 调用管理 API。
- `src/lib/auth.ts` 当前把主会话 token 放在 `localStorage`。
- `server/src/internal/session.js` 的 `adminAuth()` 同时接受 `users.is_admin`、登录/邮箱 allowlist 和长期 `ADMIN_TOKEN`。

因此，静态 `/admin/subscriptions/` HTML 本身不能作为权限边界。页面可以被任何人下载，但其中不得含秘密或功能状态；真正边界必须位于 HomePage API。

正式接入真实注册表前必须完成短时敏感会话。它必须通过明确的 OAuth 或邮件身份重新认证签发，并与当前用户绑定；不能仅把现有 localStorage Bearer token 兑换成 Cookie。`ADMIN_TOKEN` 不得访问订阅接口。

## 页面信息架构

新增路由：`src/pages/admin/subscriptions/index.astro`

管理后台首页在鉴权响应确认 `manageSubscriptions: true` 后显示“代理订阅”入口；不能仅凭 `isAdmin` 显示。

页面状态：

1. **检查中**：只显示站点通用骨架，不预取秘密。
2. **无权限**：通用无权限说明，并提供返回管理后台按钮；API 仍返回通用 `403`。
3. **已授权但锁定**：显示三张能力卡和“验证身份”按钮，不显示 URL。
4. **短时解锁**：允许执行复制或显示二维码，展示剩余时间但不展示 URL。
5. **不可用**：按 desktop、mobile、mobile QR 显示非敏感可用状态，不展示文件路径或后端异常。

能力卡：

- 桌面订阅：复制 Clash Verge Rev 订阅 URL。
- 移动订阅：复制 Clash Meta for Android 订阅 URL。
- CMFA 导入：复制 `clashmeta://` 导入链接，并在 `ModalShell` 中显示二维码。

点击“复制”后前端即时请求单个值，调用 `navigator.clipboard.writeText()`，随后清空变量引用。不要把值渲染到 DOM；失败时只显示通用提示。二维码通过鉴权 fetch 获取 Blob，使用临时 object URL，弹窗关闭后立即 `URL.revokeObjectURL()`。

## 视觉复用

实现前读取 `docs/visual-system/ui-reuse.zh-CN.md`，并遵守：

- 页面使用 `SiteLayout.astro`，宽度使用 `.page-shell`。
- 标题优先复用 `PageHeading.astro`。
- 卡片使用 `.card-surface` / `.card-interactive` 和现有语义 Token。
- 按钮、状态 Chip 和输入状态复用现有类，不复制本机 WebUI 的 CSS。
- 二维码弹窗必须复用 `ModalShell.astro`。
- 支持现有浅色/暗色主题、键盘操作、焦点恢复和 reduced-motion。
- 不在新的 Astro 文件中写内联 UI SVG；先建立或复用集中图标入口。
- 移动端 360 px 宽度不横向溢出；桌面卡片保持清楚的层级，不做“黑客终端”式独立皮肤。

本功能的视觉来源只有 HomePage 设计系统。本机面板只提供“桌面/移动/CMFA/二维码”的交互参考。

## 服务端设计

建议新增：

```text
server/src/internal/subscription-access.js
server/src/internal/permissions.js
server/src/routes/admin-subscriptions.js
server/scripts/grant-permission.mjs
```

### 配置

新增非秘密环境变量：

```text
SUBSCRIPTION_ACCESS_ENABLED=false
SUBSCRIPTION_ACCESS_REGISTRY=/var/lib/vps-proxies-subscription/access/homepage-admin.v1.json
SUBSCRIPTION_ACCESS_TTL_SECONDS=300
```

- 默认关闭；缺少注册表路径时保持关闭。
- `server/.env.example` 只能使用示例路径，不能出现 URL。
- `config.js` 对 TTL 设置 `60..300` 的边界，并在启用时要求绝对路径。

### 权限

新增通用 `user_permissions` 表，而不是继续增加登录名/邮箱环境变量：

```text
user_id | permission | granted_at | granted_by
```

唯一键为 `(user_id, permission)`。第一项权限为 `manage_subscriptions`。只有已经通过 `adminAuth()` 的真实登录用户才能继续检查权限；`adminAuth()` 内部结果需要携带 `user_id`，但 API 响应不必公开它。

初版权限只通过服务器维护脚本授予/撤销，不制作公网“管理员授权管理员”界面。脚本必须要求明确的用户 login 和固定权限枚举，支持 dry-run，并且不打印会话、URL 或数据库其他内容。生产权限变更属于服务器 mutation，需要单独确认。

### 短时敏感会话

新增用途固定为 `subscription-access` 的敏感会话表。数据库仅保存随机令牌哈希、`user_id`、用途、创建/过期时间；TTL 不超过 5 分钟。

签发流程：

1. 已登录且有权限的用户点击“验证身份”。
2. API 创建一次性重新认证 intent，记录发起用户和 return path。
3. 用户完成现有 OAuth 或邮件身份校验。
4. 回调确认外部身份映射到同一 `user_id`，然后签发敏感会话。
5. API 设置 host-only、`HttpOnly; Secure; SameSite=Strict` Cookie，并重定向回页面。

揭示接口必须同时验证 Bearer 登录会话、管理员身份、`manage_subscriptions` 和同用户敏感 Cookie。登出、显式锁定、过期或身份不一致都删除会话。Cookie 不得包含 URL。

### 注册表读取

`subscription-access.js` 每次读取后执行上游契约中的结构和语义验证：

- 只接受 schema v1。
- URL 主机、协议、query、fragment、高熵 path 和 `.yaml` 后缀严格检查。
- desktop 和 mobile 不能相同。
- QR 使用 realpath containment、拒绝符号链接、PNG 签名和 2 MiB 上限。
- CMFA import link 只从移动 URL即时派生。
- 对外错误不得包含路径、URL、原始异常或配置值。

不要从 HomePage API 解析 Nginx 配置、执行 PowerShell/SSH、调用 Windows 本地面板，也不要从浏览器直读 `sub.xgwnje.cn`。

## API

按上游契约实现：

- `GET /api/admin/subscriptions/status`
- `POST /api/admin/subscriptions/reveal`
- `GET /api/admin/subscriptions/mobile-qr`
- 敏感会话 unlock callback 和显式 lock 入口

`/api/admin/check` 可以增加：

```json
{
  "isAdmin": true,
  "permissions": {
    "manageSubscriptions": true
  }
}
```

未登录、无权限、功能关闭和注册表缺失时，不应通过响应文案或时序暴露具体原因。秘密响应设置 `private, no-store`；POST 校验精确 Origin、JSON Content-Type 和请求体上限。CORS 只允许 HomePage 的精确 origin，并在 Cookie 请求时显式允许 credentials。

审计事件只保存用户 ID、动作枚举、结果、时间和 request ID。不得记录 URL、二维码内容、真实 IP、请求 Authorization/Cookie 或原始文件异常。

## 实施阶段

### 阶段 1：夹具驱动的本地页面

- 用 `server/test/fixtures/subscription-access.v1.json` 构建注册表解析器和 API 测试。
- 完成页面、权限状态和 QR Blob 弹窗，但只连接夹具 provider。
- 运行受影响的单元、管理页检查、typecheck 和 build。
- 浏览器检查桌面、360 px 移动宽度、浅色/暗色、键盘、无权限与锁定状态。

### 阶段 2：权限与重新认证

- 增加 `user_permissions`、权限维护脚本和短时敏感会话。
- 为身份匹配、过期、登出、`ADMIN_TOKEN` 拒绝、CSRF/CORS、限流和日志脱敏写测试。
- 在真实注册表仍关闭的情况下完成安全审查。

### 阶段 3：Server-infra 接线

- 回到 `D:\ObjectCode\Server-infra`，读取 `CURRENT.md` 并现场核对服务账号、systemd 和订阅目录。
- 生成受保护注册表和二维码，配置只读组权限与环境变量。
- 任何安装、服务 reload 或真实权限授予都必须单独确认。
- mutation 后执行 `maintain.ps1 -Mode AfterChange`。

### 阶段 4：有人值守验收与上线

- 先本地和预发布验收，再单独确认部署。
- 不在普通开发迭代中自动 push 或部署。
- 上线后验证无权限矩阵、三种复制、二维码、5 分钟过期、主动锁定、日志和缓存头。
- 只报告成功/失败，不在记录中展示真实 URL、二维码或真实 IP。

## 自动化验收矩阵

服务端测试至少覆盖：

- v1 fixture 通过；未知版本、额外字段、错误 host、HTTP、query/fragment、短 path、相同 URL 拒绝。
- 注册表缺失、非法 JSON、路径穿越、符号链接、非 PNG、超大 PNG 返回通用不可用。
- 未登录、普通用户、普通管理员、`ADMIN_TOKEN` 均为 `403`。
- 有权限但未重新认证时 status 可用，reveal/QR 拒绝。
- 敏感会话属于其他用户、用途错误、过期或已锁定时拒绝。
- `desktop`、`mobile`、`cmfa-import` 正确；未知 kind 为 `400`。
- 每个秘密响应均有 `Cache-Control: private, no-store, max-age=0` 和 `Pragma: no-cache`。
- 访问日志、审计事件、错误对象和测试快照中没有 fixture URL。

前端测试至少覆盖：

- 导航入口只在 `manageSubscriptions` 为 true 时出现。
- 初始 HTML、锁定页和状态请求不包含 fixture URL。
- 复制成功后秘密不进入 DOM 或持久存储。
- QR object URL 在关闭弹窗、路由切换和错误时释放。
- 无权限、锁定、解锁、过期和不可用状态均有可访问的提示。
- 不新增内联 SVG，不绕过 `SiteLayout` 和 `ModalShell`。

最低验证：

```powershell
npm run test:admin
npm run test:ui-reuse
npm run test:api
npm run typecheck
npm run build
git diff --check
git status --short
```

未接入真实注册表时不能宣称线上闭环完成；未做浏览器检查时不能宣称视觉迁移完成。

## 非目标

- 不在 HomePage 中发布或编辑代理配置。
- 不轮换、回退或删除订阅。
- 不显示 AnyTLS 地址、端口、密码、SNI 或 Clash 控制密钥。
- 不把本地 Windows WebUI 变成公网服务。
- 不制作管理员权限管理后台。
- 不在本阶段升级 Clash Verge Rev、Mihomo 或 CMFA。

## HomePage 工作区开工口令

切换到 `D:\ObjectCode\HomePage` 后使用：

> 读取 `docs/superpowers/specs/2026-07-15-clash-subscription-admin.md` 以及其中引用的 vps-proxies v1 provider contract。按阶段 1 开始实现，只使用无密钥夹具，完成本地验证和浏览器验收；不要部署、push 或接入真实订阅。
