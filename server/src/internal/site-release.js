import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// 网页后台发布执行器：API（www-data）通过受限 sudo 调用仓库克隆中的
// site-release.mjs。sudoers 只允许这一条命令路径，参数由脚本内的
// 路径白名单二次校验。
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
		const child = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => { stdout += chunk; });
		child.stderr.on('data', (chunk) => { stderr += chunk; });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`Site release failed with exit code ${code}. ${stderr.trim() || stdout.trim()}`.slice(0, 500)));
				return;
			}
			const summaryLine = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
			try {
				resolve(JSON.parse(summaryLine));
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
