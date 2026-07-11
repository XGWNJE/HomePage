type I18nBridge = {
	text?: (key: string) => string;
};

type BlogPostWindow = Window & {
	__API_BASE?: string;
	__formatCompactViewCount?: (count: unknown) => string;
	__formatFullViewCount?: (count: unknown) => string;
	__xgwnjeI18n?: I18nBridge;
};

const runtimeWindow = () => window as BlogPostWindow;

export function getApiBase(): string {
	return runtimeWindow().__API_BASE || 'https://api.xgwnje.cn';
}

export function getI18nText(key: string, fallback: string): string {
	return runtimeWindow().__xgwnjeI18n?.text?.(key) ?? fallback;
}

export function formatFullViewCount(count: unknown): string {
	const sharedFormatter = runtimeWindow().__formatFullViewCount;
	if (sharedFormatter) return sharedFormatter(count);

	const value = Number(count);
	if (!Number.isFinite(value) || value < 0) {
		return `0 ${getI18nText('article.views', 'views')}`;
	}
	const labelKey = value === 1 ? 'article.view' : 'article.views';
	const fallback = value === 1 ? 'view' : 'views';
	return `${value.toLocaleString('en-US')} ${getI18nText(labelKey, fallback)}`;
}

export function formatCompactViewCount(count: unknown): string {
	const sharedFormatter = runtimeWindow().__formatCompactViewCount;
	if (sharedFormatter) return sharedFormatter(count);

	const value = Number(count);
	if (!Number.isFinite(value) || value < 0) return '0';
	if (value < 1000) return value.toLocaleString('en-US');
	return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
}
