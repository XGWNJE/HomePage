import {
	DEFAULT_UI_LANG,
	UI_LANGS,
	uiText,
	type UiLang,
	type UiTextKey,
} from '../../data/i18n';

const storageKey = 'xgwnje.uiLang';
let lifecycleBound = false;

const isLanguage = (value: unknown): value is UiLang =>
	typeof value === 'string' && UI_LANGS.includes(value as UiLang);

export const getStoredLanguage = (): UiLang => {
	try {
		const stored = localStorage.getItem(storageKey);
		return isLanguage(stored) ? stored : DEFAULT_UI_LANG;
	} catch {
		return DEFAULT_UI_LANG;
	}
};

export const getI18nText = (key: string, lang = getStoredLanguage()): string =>
	uiText[lang][key as UiTextKey]
		?? uiText[DEFAULT_UI_LANG][key as UiTextKey]
		?? key;

const setTranslatedAttribute = (
	selector: string,
	dataAttribute: string,
	targetAttribute: string,
	lang: UiLang,
): void => {
	document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
		const key = node.getAttribute(dataAttribute);
		if (key) node.setAttribute(targetAttribute, getI18nText(key, lang));
	});
};

export const applyLanguage = (requested = getStoredLanguage()): void => {
	const lang = isLanguage(requested) ? requested : DEFAULT_UI_LANG;
	document.documentElement.dataset.uiLang = lang;

	document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
		const key = node.getAttribute('data-i18n');
		if (key) node.textContent = getI18nText(key, lang);
	});

	setTranslatedAttribute('[data-i18n-aria-label]', 'data-i18n-aria-label', 'aria-label', lang);
	setTranslatedAttribute('[data-i18n-placeholder]', 'data-i18n-placeholder', 'placeholder', lang);
	setTranslatedAttribute('[data-i18n-title]', 'data-i18n-title', 'title', lang);

	document.querySelectorAll<HTMLButtonElement>('[data-ui-lang-option]').forEach((button) => {
		const active = button.dataset.uiLangOption === lang;
		button.classList.toggle('is-active', active);
		button.setAttribute('aria-pressed', String(active));
		if (button.dataset.uiLangBound === 'true') return;
		button.dataset.uiLangBound = 'true';
		button.addEventListener('click', () => {
			const nextLang = button.dataset.uiLangOption;
			if (!isLanguage(nextLang)) return;
			try {
				localStorage.setItem(storageKey, nextLang);
			} catch {}
			applyLanguage(nextLang);
		});
	});

	window.dispatchEvent(new CustomEvent('xgwnje:ui-language', { detail: { lang } }));
};

export const i18nBridge = {
	get lang(): UiLang {
		return getStoredLanguage();
	},
	setLang(lang: UiLang): void {
		if (!isLanguage(lang)) return;
		try {
			localStorage.setItem(storageKey, lang);
		} catch {}
		applyLanguage(lang);
	},
	apply: applyLanguage,
	text: getI18nText,
};

export const initI18n = (): void => {
	window.__xgwnjeI18n = i18nBridge;
	applyLanguage();
	if (lifecycleBound) return;
	lifecycleBound = true;
	document.addEventListener('astro:page-load', () => applyLanguage());
	document.addEventListener('astro:after-swap', () => applyLanguage());
};
