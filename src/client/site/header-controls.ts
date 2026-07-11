const themeStorageKey = 'theme';
let rssDocumentBindingsInstalled = false;

type Theme = 'light' | 'dark';
type SiteViewTransition = {
	ready: Promise<void>;
	finished: Promise<void>;
};

const selectedTheme = (): Theme => {
	const stored = localStorage.getItem(themeStorageKey);
	if (stored === 'dark' || stored === 'light') return stored;
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const syncThemeColor = (dark: boolean): void => {
	document.querySelector('meta[name="theme-color"]')
		?.setAttribute('content', dark ? '#09090b' : '#fafafa');
};

const applyStoredTheme = (): boolean => {
	const theme = selectedTheme();
	const dark = theme === 'dark';
	document.documentElement.classList.toggle('dark', dark);
	document.documentElement.dataset.theme = theme;
	syncThemeColor(dark);
	return dark;
};

const updateThemeAria = (): void => {
	const dark = document.documentElement.classList.contains('dark');
	document.querySelectorAll<HTMLButtonElement>('[id="theme-toggle"], [id="theme-toggle-mobile"]').forEach((button) => {
		button.setAttribute('aria-pressed', String(dark));
		button.dataset.themeState = dark ? 'dark' : 'light';
	});
};

export const initThemeControls = (): void => {
	const root = document.documentElement;
	document.querySelectorAll<HTMLButtonElement>('[id="theme-toggle"], [id="theme-toggle-mobile"]').forEach((button) => {
		if (button.dataset.bound === 'true') return;
		button.dataset.bound = 'true';
		button.addEventListener('click', (event) => {
			const applyTheme = (): void => {
				const dark = root.classList.toggle('dark');
				root.dataset.theme = dark ? 'dark' : 'light';
				localStorage.setItem(themeStorageKey, dark ? 'dark' : 'light');
				syncThemeColor(dark);
				updateThemeAria();
			};
			const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			const startViewTransition = (document as Document & {
				startViewTransition?: (callback: () => void) => SiteViewTransition;
			}).startViewTransition?.bind(document);
			if (!startViewTransition || reducedMotion) {
				applyTheme();
				return;
			}

			const rect = button.getBoundingClientRect();
			const x = event.clientX || rect.left + rect.width / 2;
			const y = event.clientY || rect.top + rect.height / 2;
			const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
			root.classList.add('theme-vt');
			const transition = startViewTransition(applyTheme);
			transition.ready.then(() => {
				root.animate({
					clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
				}, {
					duration: 500,
					easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
					pseudoElement: '::view-transition-new(root)',
				});
			}).catch(() => {});
			transition.finished.catch(() => {}).finally(() => root.classList.remove('theme-vt'));
		});
	});
	applyStoredTheme();
	updateThemeAria();
};

const closeRssMenu = (): void => {
	document.getElementById('rss-button')?.setAttribute('aria-expanded', 'false');
	document.getElementById('rss-menu')?.classList.add('hidden');
};

export const initRssDropdown = (): void => {
	const dropdown = document.getElementById('rss-dropdown');
	const button = document.getElementById('rss-button');
	const menu = document.getElementById('rss-menu');
	if (!dropdown || !button || !menu) return;
	if (button.dataset.rssBound !== 'true') {
		button.dataset.rssBound = 'true';
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			const expanded = button.getAttribute('aria-expanded') === 'true';
			button.setAttribute('aria-expanded', String(!expanded));
			menu.classList.toggle('hidden', expanded);
		});
	}
	if (rssDocumentBindingsInstalled) return;
	rssDocumentBindingsInstalled = true;
	document.addEventListener('click', (event) => {
		const currentDropdown = document.getElementById('rss-dropdown');
		if (currentDropdown && event.target instanceof Node && !currentDropdown.contains(event.target)) closeRssMenu();
	});
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !document.getElementById('rss-menu')?.classList.contains('hidden')) closeRssMenu();
	});
};
