export type FriendLink = {
	name: string;
	url: string;
	kind: 'github' | 'bilibili' | 'project';
	github?: string;
	bilibili?: string;
	type?: 'github' | 'bilibili';
	avatar?: string;
	description?: string;
	tags?: string[];
	status?: 'active' | 'inactive';
};

export const links: FriendLink[] = [
	{
		name: 'XGWNJE',
		kind: 'github',
		github: 'XGWNJE',
		url: 'https://github.com/XGWNJE',
		description: 'XGWNJE / 邢文杰的 GitHub 主页，收录个人代码、工具和工程实践。',
		tags: ['GitHub', 'XGWNJE'],
		status: 'active',
	},
	{
		name: 'Dancncn / Dan_Arnoux',
		kind: 'github',
		github: 'Dancncn',
		url: 'https://github.com/Dancncn',
		description: '本站 fork 来源 DansBlog 的原作者 GitHub 主页，感谢其开源博客基础。',
		tags: ['GitHub', 'Original Author'],
		status: 'active',
	},
];
