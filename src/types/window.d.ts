import type { User } from '../lib/auth';

type UiLanguage = 'cn' | 'en';

interface SiteAuthBridge {
	storeTokenFromHash: () => string | null;
	getAuthToken: () => string | null;
	getCurrentUser: () => Promise<User | null>;
	logout: () => Promise<void>;
	getGithubLoginUrl: () => string;
	startGithubLogin: () => void;
}

interface SiteI18nBridge {
	readonly lang: UiLanguage;
	setLang: (lang: UiLanguage) => void;
	apply: (lang?: UiLanguage) => void;
	text: (key: string, lang?: UiLanguage) => string;
}

declare global {
	interface Window {
		__API_BASE?: string;
		__auth?: SiteAuthBridge;
		__xgwnjeI18n?: SiteI18nBridge;
		__formatCompactViewCount?: (count: unknown) => string;
		__formatFullViewCount?: (count: unknown) => string;
	}

	interface WindowEventMap {
		'blog:user-updated': CustomEvent<{
			avatarUrl?: string;
			username?: string;
			login?: string;
		}>;
	}
}

export {};
