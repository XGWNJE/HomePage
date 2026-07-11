import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const about = readFileSync('src/pages/about.astro', 'utf8');
const componentPath = 'src/components/CharacterDialogue.astro';
const visualAssets = readFileSync('src/data/visualAssets.ts', 'utf8');

assert(existsSync(componentPath), 'CharacterDialogue component must exist');
const component = readFileSync(componentPath, 'utf8');

assert.match(about, /关于这里的主人/);
assert.match(about, /About · Conversation 001/);
assert.match(about, /我喜欢折腾软件、自动化和 AI Agent/);
assert.match(about, /所以，你平时在做什么？/);
assert.match(about, /具体项目还在整理/);
assert.match(about, /那为什么还要写博客？/);
assert.match(about, /怎么联系？/);
assert.doesNotMatch(about, /VisionGuard|Vigil|MarkPad|CmdPaster|visual-rules-collection|readme-polish/);
assert.match(about, /visualAssets\.sandrone\.aboutObserver/);
assert.match(about, /CharacterDialogue/);
assert.match(about, /非官方虚拟助手形象/);
assert.match(about, /openContactModal\?\.\(\)/);
assert.match(about, /astro:page-load/);
assert.doesNotMatch(about, /new CustomEvent\('open-contact-modal'\)/);
assert.doesNotMatch(
	about,
	/资深程序员|软件工程师|技术专家|独立开发者|创业者|产品创始人|AI 研究者|架构师|Agent 专家/,
);
assert.doesNotMatch(
	about,
	/产品矩阵|构建.{0,12}技术生态|拥有大量用户|具有行业影响|产生行业影响|改变世界|走在.{0,12}技术前沿/,
);
assert.match(component, /<aside/);
assert.match(component, /avatarAlt/);
assert.match(component, /visualAssets\.mascot\.ownerDialog/);
assert.match(visualAssets, /about-observer-v1\.webp/);
assert.match(visualAssets, /xgwnje-cat-dialog-v1\.webp/);
assert(existsSync('public/image/sandrone/about-observer-v1.webp'));
assert(existsSync('public/image/sandrone/dialog-chibi-v1.webp'));
assert(existsSync('public/image/mascot/xgwnje-cat-dialog-v1.webp'));

console.log('About page contract verified.');
