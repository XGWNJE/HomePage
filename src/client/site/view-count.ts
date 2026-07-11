import { getI18nText } from './i18n';

export const formatCompactViewCount = (count: unknown): string => {
	const value = Number(count);
	if (!Number.isFinite(value) || value < 0) return '0';
	if (value >= 1000) {
		return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
	}
	return value.toLocaleString('en-US');
};

export const formatFullViewCount = (count: unknown): string => {
	const value = Number(count);
	if (!Number.isFinite(value) || value < 0) {
		return `0 ${getI18nText('article.views', undefined) || 'views'}`;
	}
	const key = value === 1 ? 'article.view' : 'article.views';
	const fallback = value === 1 ? 'view' : 'views';
	return `${value.toLocaleString('en-US')} ${getI18nText(key, undefined) || fallback}`;
};

export const installViewCountBridge = (): void => {
	window.__formatCompactViewCount = formatCompactViewCount;
	window.__formatFullViewCount = formatFullViewCount;
};
