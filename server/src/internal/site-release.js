import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// 网页后台发布执行器：API（homepage-api 用户，隶属 www-data 组）直接调用
// 仓库克隆中的 site-release.mjs；/var/www 与其 releases 目录通过属组授权，
// 克隆由 homepage-api 持有，git 推送使用其专属 deploy key（仅限本仓库）。
// 无 sudo、无 root。参数由脚本内的路径白名单二次校验。
//
// 注意：子进程不继承 API 服务环境。API 自身的 BASE_URL（回调地址，指向
// api.xgwnje.cn）若泄露进 Astro 构建，会把全站导航链接拼成 API 域名。
const RELEASE_CHILD_ENV = (() => {
	const env = { ...process.env };
	delete env.BASE_URL;
	delete env.PUBLIC_API_BASE_URL;
	return env;
})();

export function runSiteRelease(config, { writes = [], deletes = [], message }) {
	const script = join(config.siteRepoDir, 'server', 'scripts', 'site-release.mjs');
	const args = [];
	if (config.siteReleaseUseSudo) args.push('/usr/bin/sudo', '-n');
	args.push(
		process.execPath,
		script,
		'--repo', config.siteRepoDir,
		'--message', message,
		'--node-bin', config.siteReleaseNodeBin,
	);
	for (const { repoPath, contentPath } of writes) args.push('--write', `${repoPath}=${contentPath}`);
	for (const repoPath of deletes) args.push('--delete', repoPath);

	return new Promise((resolve, reject) => {
		const child = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env: RELEASE_CHILD_ENV });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => { stdout += chunk; });
		child.stderr.on('data', (chunk) => { stderr += chunk; });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				// 保留输出尾部：npm/构建工具的真正错误通常在大段警告之后。
				const output = (stderr.trim() || stdout.trim());
				reject(new Error(`Site release failed with exit code ${code}. ${output.slice(-800)}`));
				return;
			}
			const jsonStart = stdout.lastIndexOf('\n{');
			try {
				resolve(JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart + 1) : stdout.trim()));
			} catch {
				resolve({ raw: stdout.trim().slice(-500) });
			}
		});
	});
}

// 尽力同步发布克隆；同步命令不存在（本地开发）时跳过，失败不阻断读取。
export function syncSiteRepo(config) {
	if (!config.siteRepoSyncCommand || !existsSync(config.siteRepoSyncCommand)) return { synced: false, reason: 'unavailable' };
	const result = config.siteReleaseUseSudo
		? spawnSync('/usr/bin/sudo', ['-n', config.siteRepoSyncCommand], { encoding: 'utf8', timeout: 60_000 })
		: spawnSync(config.siteRepoSyncCommand, [], { encoding: 'utf8', timeout: 60_000 });
	return { synced: result.status === 0, reason: result.status === 0 ? 'ok' : (result.stderr || result.stdout || 'failed').trim().slice(0, 200) };
}
