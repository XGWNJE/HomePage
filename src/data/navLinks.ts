import { DEFAULT_UI_LANG, t, type UiLang, type UiTextKey } from './i18n';

export const NAV_ITEMS: Array<{ path: string; labelKey: UiTextKey }> = [
	{ path: '', labelKey: 'nav.home' },
	{ path: 'blog/', labelKey: 'nav.blog' },
	{ path: 'tags/', labelKey: 'nav.tags' },
	{ path: 'links/', labelKey: 'nav.links' },
	{ path: 'about/', labelKey: 'nav.about' },
];

export const getNavLinks = (base: string, lang: UiLang = DEFAULT_UI_LANG) =>
	NAV_ITEMS.map((item) => ({
		href: `${base}${item.path}`,
		label: t(item.labelKey, lang),
		labelKey: item.labelKey,
	}));
