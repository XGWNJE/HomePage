import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function routeToDistPath(route) {
	if (route === '/') return 'index.html';
	return route.endsWith('/') ? `${route.replace(/^\/+|\/+$/g, '')}/index.html` : route.replace(/^\/+/, '');
}

async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

function extractLocalTargets(html) {
	const targets = new Set();
	const attributePattern = /\b(?:href|src)=(?:"([^"]+)"|'([^']+)')/giu;
	for (const match of html.matchAll(attributePattern)) {
		const value = match[1] ?? match[2];
		if (!value?.startsWith('/') || value.startsWith('//')) continue;
		const target = value.split(/[?#]/u, 1)[0];
		if (target) targets.add(decodeURIComponent(target));
	}
	return [...targets].sort();
}

export async function findMissingLocalReleaseTargets({ distRoot, routes }) {
	const resolvedDist = path.resolve(distRoot);
	const missing = [];
	for (const route of routes) {
		const htmlPath = path.join(resolvedDist, routeToDistPath(route));
		const html = await readFile(htmlPath, 'utf8');
		for (const target of extractLocalTargets(html)) {
			const relative = routeToDistPath(target);
			const candidate = path.resolve(resolvedDist, relative);
			const rootPrefix = `${resolvedDist}${path.sep}`;
			if (candidate !== resolvedDist && !candidate.startsWith(rootPrefix)) {
				missing.push({ route, target });
				continue;
			}
			if (await fileExists(candidate)) continue;
			if (!path.extname(relative) && await fileExists(path.join(resolvedDist, relative, 'index.html'))) continue;
			missing.push({ route, target });
		}
	}
	return missing;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const rootIndex = process.argv.indexOf('--root');
	const routesIndex = process.argv.indexOf('--routes-json');
	const routesJson = process.env.CONTENT_RELEASE_LINK_ROUTES_JSON
		|| (routesIndex >= 0 ? process.argv[routesIndex + 1] : '')
		|| '[]';
	if (rootIndex < 0) {
		throw new Error('Usage: content-release-links.mjs --root <dist>');
	}
	const missing = await findMissingLocalReleaseTargets({
		distRoot: process.argv[rootIndex + 1],
		routes: JSON.parse(routesJson),
	});
	process.stdout.write(JSON.stringify({ missing }));
}
