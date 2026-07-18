import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const fail = (message) => {
	console.error(`[ui-i18n] ${message}`);
	process.exitCode = 1;
};

const i18nPath = 'src/data/i18n.ts';
let i18nSource = '';
try {
	i18nSource = await read(i18nPath);
} catch {
	fail(`${i18nPath} is missing`);
}

const requiredKeys = [
	'nav.home',
	'nav.blog',
	'nav.tags',
	'nav.links',
	'nav.about',
	'language.chinese',
	'language.english',
	'blog.important',
	'blog.latest',
	'blog.archive',
	'home.latestPosts',
	'home.viewAll',
	'footer.contact',
	'footer.motionPaused',
	'footer.motionHelp',
	'login.title',
	'contact.title',
	'settings.title',
	'comments.title',
	'links.profiles',
	'links.webEffects',
	'links.inspiration',
	'links.crossPlatform',
];

for (const key of requiredKeys) {
	const quotedKey = new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`);
	if (!quotedKey.test(i18nSource)) fail(`${i18nPath} is missing key ${key}`);
}

for (const inaccurateCopy of [
	'会经过 AI 审核',
	'reviewed by AI',
	'所有留言发送前都会经过审核',
	'All messages will be reviewed before being sent',
]) {
	if (i18nSource.includes(inaccurateCopy)) fail(`${i18nPath} still contains inaccurate review copy: ${inaccurateCopy}`);
}

const fileChecks = [
	['src/components/Header.astro', ['data-ui-lang-option', 'data-i18n={link.labelKey}', 'startHeaderRuntime']],
	['src/client/site/i18n.ts', ['window.__xgwnjeI18n', 'applyLanguage', "from '../../data/i18n'", 'document.documentElement.lang', "'zh-CN'"]],
	['src/components/MobileDrawer.astro', ['XGWNJE', 'data-i18n={link.labelKey}']],
	['src/components/Footer.astro', ['data-i18n="footer.contact"', 'data-motion-hint', 'data-i18n="footer.motionPaused"', 'data-i18n="footer.motionHelp"']],
	['src/components/LoginModal.astro', ['data-i18n="login.title"']],
	['src/components/ContactModal.astro', ['data-i18n="contact.title"']],
	['src/components/SettingsModal.astro', ['data-i18n="settings.title"']],
	['src/components/BlogViewTabs.astro', ['data-i18n={tab.labelKey}', "labelKey: 'blog.important'", "labelKey: 'blog.latest'", "labelKey: 'blog.archive'"]],
	['src/components/Comment.astro', ['data-i18n="comments.title"']],
	['src/pages/index.astro', ['data-i18n="home.latestPosts"', 'data-i18n="home.viewAll"']],
	['src/pages/blog/index.astro', ['<BlogViewTabs', 'data-i18n-content-lang']],
	['src/pages/tags/index.astro', ['titleKey="tags.title"']],
	['src/pages/links/index.astro', ['data-i18n={group.titleKey}', 'data-i18n={group.subtitleKey}', '<LinkCard']],
];

for (const [relativePath, needles] of fileChecks) {
	let source = '';
	try {
		source = await read(relativePath);
	} catch {
		fail(`${relativePath} is missing`);
		continue;
	}
	for (const needle of needles) {
		if (!source.includes(needle)) fail(`${relativePath} is missing ${needle}`);
	}
}

const mobileDrawer = await read('src/components/MobileDrawer.astro');
if (mobileDrawer.includes('Dan<span') || mobileDrawer.includes('Dan&rsquo;s')) {
	fail('MobileDrawer still contains the old Dan brand');
}

if (process.exitCode) process.exit(process.exitCode);
console.log('[ui-i18n] ok');
