export const API_BASE =
	import.meta.env.PUBLIC_API_BASE_URL ??
	(import.meta.env.DEV ? 'http://localhost:8787' : 'https://api.xgwnje.cn');
export const TOKEN_KEY = 'blog_token';
