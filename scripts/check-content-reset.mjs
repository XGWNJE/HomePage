import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const blogDir = path.join(root, 'src', 'content', 'blog');
const expectedPosts = ['hello-xgwnje-index-cn.md', 'hello-xgwnje-index-en.md'];
const forbiddenContent = [
	/Dan_Arnoux/i,
	/Dancncn/i,
	/danarnoux/i,
	/img\.danarnoux\.com/i,
];

const entries = await readdir(blogDir, { withFileTypes: true });
const markdownPosts = entries
	.filter((entry) => entry.isFile() && /\.mdx?$/.test(entry.name))
	.map((entry) => entry.name)
	.sort();
const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

const fail = (message) => {
	console.error(`[content-reset] ${message}`);
	process.exitCode = 1;
};

if (JSON.stringify(markdownPosts) !== JSON.stringify(expectedPosts)) {
	fail(`expected only ${expectedPosts.join(', ')}, found ${markdownPosts.join(', ') || '(none)'}`);
}

if (directories.length > 0) {
	fail(`expected no old article asset directories, found ${directories.join(', ')}`);
}

for (const file of markdownPosts) {
	const fullPath = path.join(blogDir, file);
	const content = await readFile(fullPath, 'utf8');
	if (!content.includes('group: "hello-xgwnje-index"')) {
		fail(`${file} must belong to group "hello-xgwnje-index"`);
	}
	if (!/lang:\s*"(cn|en)"/.test(content)) {
		fail(`${file} must declare lang "cn" or "en"`);
	}
	for (const pattern of forbiddenContent) {
		if (pattern.test(content)) {
			fail(`${file} still references original-author content: ${pattern}`);
		}
	}
}

if (process.exitCode) process.exit(process.exitCode);
console.log('[content-reset] ok');
