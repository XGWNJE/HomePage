export type LinkGroup = 'profiles' | 'web-effects' | 'inspiration' | 'cross-platform';

export type FriendLink = {
	name: string;
	url: string;
	group: LinkGroup;
	github?: string;
	avatar?: string;
	description?: string;
	tags?: string[];
	status?: 'active' | 'inactive';
};

export const links: FriendLink[] = [
	{
		name: 'XGWNJE',
		group: 'profiles',
		github: 'XGWNJE',
		url: 'https://github.com/XGWNJE',
		description: 'XGWNJE / 邢文杰的 GitHub 主页，收录个人代码、工具和工程实践。',
		tags: ['GitHub', 'XGWNJE'],
		status: 'active',
	},
	{
		name: 'Dancncn / Dan_Arnoux',
		group: 'profiles',
		github: 'Dancncn',
		url: 'https://github.com/Dancncn',
		description: '本站 fork 来源 DansBlog 的原作者 GitHub 主页，感谢其开源博客基础。',
		tags: ['GitHub', 'Original Author'],
		status: 'active',
	},
	{
		name: 'Magic UI',
		group: 'web-effects',
		url: 'https://magicui.design/docs/components',
		description: '面向 React、Tailwind 与 shadcn 的实用动效组件，涵盖光束、粒子、文字和边框效果。',
		tags: ['React', 'Tailwind', 'MIT'],
		status: 'active',
	},
	{
		name: 'Aceternity UI',
		group: 'web-effects',
		url: 'https://ui.aceternity.com/categories',
		description: '聚焦 3D、Shader、视差、Canvas 与复杂 Hero 的高表现力网页效果。',
		tags: ['React', '3D', 'Shader'],
		status: 'active',
	},
	{
		name: 'Animata',
		group: 'web-effects',
		url: 'https://animata.design/',
		description: '可复用的动效组件与界面形态，覆盖卡片、背景、Bento 布局和微交互。',
		tags: ['Components', 'Motion', 'A11y'],
		status: 'active',
	},
	{
		name: 'Motion Primitives',
		group: 'web-effects',
		url: 'https://motion-primitives.com/docs',
		description: '更偏工程化的产品动效基础件，适合研究弹窗、磁吸与渐进模糊等交互。',
		tags: ['React', 'Interaction', 'Motion'],
		status: 'active',
	},
	{
		name: 'Fancy Components',
		group: 'web-effects',
		url: 'https://www.fancycomponents.dev/docs/introduction',
		description: '专门收集有趣、非常规的微交互，适合在需要新鲜感时寻找切入点。',
		tags: ['Micro-interactions', 'React', 'Ideas'],
		status: 'active',
	},
	{
		name: 'Hover.dev',
		group: 'web-effects',
		url: 'https://www.hover.dev/',
		description: '提供 React、Tailwind 与 Motion 组件，也有带动效的 Hero、定价和功能区块。',
		tags: ['React', 'Tailwind', 'Landing Page'],
		status: 'active',
	},
	{
		name: 'Codrops',
		group: 'inspiration',
		url: 'https://tympanus.net/codrops/',
		description: '长期积累的 WebGL、Three.js、GSAP、滚动叙事与实验性交互案例库。',
		tags: ['WebGL', 'Three.js', 'GSAP'],
		status: 'active',
	},
	{
		name: '21st.dev',
		group: 'inspiration',
		url: 'https://21st.dev/community/components',
		description: '社区组件市场，可用于发现 Shader、Spline、发光卡片和滚动 Hero 等新效果。',
		tags: ['Community', 'Shader', 'UI'],
		status: 'active',
	},
	{
		name: 'Rive',
		group: 'cross-platform',
		url: 'https://rive.app/docs/runtimes/getting-started',
		description: '设计一次、在 Web、Android、Apple 等运行时播放的交互动效系统。',
		tags: ['Web', 'Android', 'Apple'],
		status: 'active',
	},
	{
		name: 'Haze',
		group: 'cross-platform',
		url: 'https://github.com/chrisbanes/haze',
		description: 'Compose Multiplatform 的模糊与背景材质效果引擎，适合研究玻璃质感。',
		tags: ['Compose', 'Blur', 'Kotlin'],
		status: 'active',
	},
	{
		name: 'Pow',
		group: 'cross-platform',
		url: 'https://github.com/EmergeTools/Pow',
		description: '面向 SwiftUI 的转场、粒子与微交互库，适合原生端动效参考。',
		tags: ['SwiftUI', 'Transitions', 'Particles'],
		status: 'active',
	},
	{
		name: 'Inferno',
		group: 'cross-platform',
		url: 'https://github.com/twostraws/Inferno',
		description: 'SwiftUI 的 Metal Shader 集合，包含水波、噪声、渐变、扭曲等 GPU 效果。',
		tags: ['SwiftUI', 'Metal', 'Shader'],
		status: 'active',
	},
];
