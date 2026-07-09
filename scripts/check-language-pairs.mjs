import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const contentDir = join(process.cwd(), 'src', 'content', 'blog');
const entries = readdirSync(contentDir)
	.filter((name) => /\.mdx?$/.test(name))
	.sort()
	.map((name) => {
		const id = name.replace(/\.mdx?$/, '');
		const text = readFileSync(join(contentDir, name), 'utf8');
		const frontmatter = text.startsWith('---') ? text.split('---', 3)[1] ?? '' : '';
		const lang = readField(frontmatter, 'lang') || inferLang(id);
		const group = readField(frontmatter, 'group') || id.replace(/-(cn|en)$/, '');
		return { id, lang, group };
	});

const problems = [];
const groupLangCounts = new Map();

for (const entry of entries) {
	if (entry.lang !== 'cn' && entry.lang !== 'en') continue;
	const key = `${entry.group}:${entry.lang}`;
	const bucket = groupLangCounts.get(key) ?? [];
	bucket.push(entry.id);
	groupLangCounts.set(key, bucket);
}

for (const [key, ids] of groupLangCounts) {
	if (ids.length > 1) {
		problems.push(`duplicate group/lang ${key}: ${ids.join(', ')}`);
	}
}

for (const entry of entries) {
	if (entry.lang !== 'cn' && entry.lang !== 'en') continue;
	const targetLang = entry.lang === 'cn' ? 'en' : 'cn';
	const directTargetId = entry.id.replace(/-(cn|en)$/, `-${targetLang}`);
	const candidates = entries.filter((item) => item.id !== entry.id && item.lang === targetLang && item.group === entry.group);
	const directTarget = entries.find((item) => item.id === directTargetId && item.lang === targetLang);
	if (!directTarget) {
		problems.push(`${entry.id} has no direct ${targetLang} counterpart ${directTargetId}`);
	}
	if (candidates.length !== 1) {
		problems.push(`${entry.id} has ${candidates.length} ${targetLang} group candidate(s): ${candidates.map((item) => item.id).join(', ') || 'none'}`);
	}
}

if (problems.length) {
	console.error(`Language pairing check failed with ${problems.length} problem(s):`);
	for (const problem of problems) console.error(`- ${problem}`);
	process.exit(1);
}

console.log(`Language pairing check passed for ${entries.length} post(s).`);

function readField(frontmatter, name) {
	const match = frontmatter.match(new RegExp(`^${name}:\\s*["']?([^"'\\r\\n]+)`, 'm'));
	return match?.[1]?.trim() ?? '';
}

function inferLang(id) {
	const match = id.match(/-(cn|en)$/);
	return match?.[1] ?? '';
}
