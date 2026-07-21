// 本地验收预览：同时启动后端（DEV_LOGIN）与前端 dev server，
// 自动用专用验收管理员账号 preview-admin 登录并打开浏览器。
// 仅本地可用：DEV_LOGIN 在生产环境会被 config 拒绝启动，token 不落盘、不提交。
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = 8787;
const WEB_PORT = 4321;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
const PREVIEW_LOGIN = 'preview-admin';
const PREVIEW_NAME = 'Preview Admin';

const children = [];
const shutdown = (code = 0) => {
	for (const child of children) {
		try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
	}
	process.exit(code);
};
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const pipeLogs = (child, tag) => {
	const forward = (chunk) => {
		for (const line of String(chunk).split(/\r?\n/)) {
			if (line.trim()) console.log(`[${tag}] ${line}`);
		}
	};
	child.stdout.on('data', forward);
	child.stderr.on('data', forward);
};

const spawnChild = (command, args, options, tag) => {
	const child = spawn(command, args, { cwd: ROOT, ...options });
	pipeLogs(child, tag);
	child.on('exit', (code) => {
		console.log(`[${tag}] 进程退出 (code ${code})，预览结束`);
		shutdown(code ?? 1);
	});
	children.push(child);
	return child;
};

const waitFor = async (fn, label, attempts = 60) => {
	for (let i = 0; i < attempts; i += 1) {
		try {
			const result = await fn();
			if (result) return result;
		} catch { /* 服务未就绪，继续等 */ }
		await delay(1000);
	}
	throw new Error(`${label} 等待超时`);
};

// 1. 启动本地后端（DEV_LOGIN=true，仅非生产可用）
spawnChild('node', ['server/src/server.js'], {
	env: {
		...process.env,
		NODE_ENV: 'development',
		DEV_LOGIN: 'true',
		PORT: String(API_PORT),
		HOST: '127.0.0.1',
		HOMEPAGE_API_DATA_DIR: join(ROOT, 'server-data'),
		PUBLIC_ALLOWED_ORIGIN: WEB_ORIGIN,
	},
}, 'api');

// 2. 等待后端就绪，并用专用验收管理员账号登录拿 token
const token = await waitFor(async () => {
	const res = await fetch(`${API_ORIGIN}/api/auth/dev-login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ login: PREVIEW_LOGIN, name: PREVIEW_NAME }),
	});
	if (!res.ok) return null;
	const payload = await res.json();
	return payload.ok && payload.token ? payload.token : null;
}, '后端 dev-login');
console.log(`[preview] 验收管理员账号 ${PREVIEW_LOGIN} 登录成功`);

// 3. 启动前端 dev server
const npmCmd = process.platform === 'win32' ? 'npm' : 'npm';
spawnChild(npmCmd, ['run', 'dev', '--', '--port', String(WEB_PORT)], { shell: process.platform === 'win32' }, 'web');

await waitFor(async () => {
	const res = await fetch(WEB_ORIGIN);
	return res.ok;
}, '前端 dev server');

// 4. 打开浏览器（hash 里的 token 由前端 storeTokenFromHash 接管）
const url = `${WEB_ORIGIN}/#token=${encodeURIComponent(token)}`;
console.log(`\n[preview] 本地预览已就绪：${WEB_ORIGIN}`);
console.log(`[preview] 已用 ${PREVIEW_LOGIN} 自动登录，头像菜单应显示"后台管理"入口`);
console.log('[preview] 关闭本窗口或按 Ctrl+C 结束预览（前后端会一起停止）\n');
if (process.platform === 'win32') {
	spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
} else {
	console.log(`[preview] 请手动打开：${url}`);
}
