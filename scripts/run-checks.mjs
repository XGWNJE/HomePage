// 仓库约定检查的统一入口。
// 新增检查规则：创建 scripts/check-<name>.mjs 并在 CHECKS 登记表加一行即可，
// 不要再为单个检查新增 package.json 脚本别名。
// 用法：node scripts/run-checks.mjs [name ...]（不带参数时运行全部）
import { spawnSync } from 'node:child_process';

const CHECKS = [
	['language-pairs', 'scripts/check-language-pairs.mjs'],
	['brand-assets', 'scripts/check-brand-assets.mjs'],
	['ui-reuse', 'scripts/check-ui-reuse.mjs'],
	['header-responsive', 'scripts/check-header-responsive.mjs'],
	['links-page', 'scripts/check-links-page.mjs'],
	['ui-i18n', 'scripts/check-ui-i18n.mjs'],
	['about-page', 'scripts/check-about-page.mjs'],
	['admin-page', 'scripts/check-admin-page.mjs'],
	['admin-subscriptions', 'scripts/check-admin-subscriptions.mjs'],
];

const filters = process.argv.slice(2);
const known = new Set(CHECKS.map(([name]) => name));
const unknown = filters.filter((name) => !known.has(name));
if (unknown.length > 0) {
	console.error(`Unknown check(s): ${unknown.join(', ')}`);
	console.error(`Known checks: ${[...known].join(', ')}`);
	process.exit(1);
}
const selected = filters.length > 0 ? CHECKS.filter(([name]) => filters.includes(name)) : CHECKS;

let failed = 0;
for (const [name, script] of selected) {
	const startedAt = Date.now();
	const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });
	const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
	if (result.status === 0) {
		console.log(`PASS ${name} (${seconds}s)`);
	} else {
		failed += 1;
		console.error(`FAIL ${name} (${seconds}s)`);
	}
}

console.log(`${selected.length - failed}/${selected.length} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
