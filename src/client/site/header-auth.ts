import { getToken, getUser, logout, storeTokenFromHash, type User } from '../../lib/auth';
import { checkAdmin } from '../../lib/admin';

const fallbackAvatar = '/image/favicon-192.png';
let documentBindingsInstalled = false;

const closeDropdown = (): void => {
	const button = document.getElementById('user-dropdown-button');
	const menu = document.getElementById('user-dropdown-menu');
	button?.setAttribute('aria-expanded', 'false');
	menu?.classList.add('opacity-0', 'invisible');
	menu?.classList.remove('opacity-100', 'visible');
};

const applyUserToUi = (user: Partial<User>): void => {
	const avatar = user.avatar || fallbackAvatar;
	const username = user.username || 'User';
	const userAvatar = document.getElementById('user-avatar') as HTMLImageElement | null;
	const dropdownAvatar = document.getElementById('dropdown-user-avatar') as HTMLImageElement | null;
	const userName = document.getElementById('user-name');
	if (userAvatar) userAvatar.src = avatar;
	if (dropdownAvatar) dropdownAvatar.src = avatar;
	if (userName) userName.textContent = username;
};

const openLoginModal = (): void => {
	const modal = document.getElementById('login-modal');
	if (!modal) return;
	requestAnimationFrame(() => {
		modal.classList.remove('opacity-0', 'invisible');
		modal.classList.add('opacity-100');
		modal.querySelector('.modal-content')?.classList.remove('scale-95', 'opacity-0');
		modal.querySelector('.modal-content')?.classList.add('scale-100', 'opacity-100');
		modal.setAttribute('aria-hidden', 'false');
	});
};

const closeLoginModal = (): void => {
	const modal = document.getElementById('login-modal');
	if (!modal) return;
	modal.classList.remove('opacity-100');
	modal.classList.add('opacity-0');
	modal.querySelector('.modal-content')?.classList.remove('scale-100', 'opacity-100');
	modal.querySelector('.modal-content')?.classList.add('scale-95', 'opacity-0');
	modal.setAttribute('aria-hidden', 'true');
	window.setTimeout(() => modal.classList.add('invisible'), 200);
};

const showLoginButton = (): void => {
	const loginButton = document.getElementById('auth-button');
	const dropdown = document.getElementById('user-dropdown');
	loginButton?.classList.remove('hidden');
	loginButton?.classList.add('inline-flex');
	dropdown?.classList.add('hidden');
	if (dropdown) dropdown.style.display = '';
	const adminLink = document.getElementById('header-admin-link');
	if (adminLink) adminLink.style.display = 'none';
	closeDropdown();
};

const refreshAdminEntry = async (): Promise<void> => {
	const adminLink = document.getElementById('header-admin-link');
	if (!adminLink) return;
	const { isAdmin } = await checkAdmin();
	if (adminLink.isConnected) adminLink.style.display = isAdmin ? '' : 'none';
};

const showUserDropdown = (): void => {
	const loginButton = document.getElementById('auth-button');
	const dropdown = document.getElementById('user-dropdown');
	loginButton?.classList.add('hidden');
	loginButton?.classList.remove('inline-flex');
	dropdown?.classList.remove('hidden');
	if (dropdown) dropdown.style.display = 'block';
};

const installDocumentBindings = (): void => {
	if (documentBindingsInstalled) return;
	documentBindingsInstalled = true;
	window.addEventListener('blog:user-updated', (event) => {
		applyUserToUi({
			avatar: event.detail.avatarUrl,
			username: event.detail.username,
			login: event.detail.login,
		});
	});
	document.addEventListener('click', (event) => {
		const dropdown = document.getElementById('user-dropdown');
		if (dropdown && event.target instanceof Node && !dropdown.contains(event.target)) closeDropdown();
	});
};

const bindHeaderElements = (): void => {
	const loginButton = document.getElementById('auth-button');
	const dropdown = document.getElementById('user-dropdown');
	const dropdownButton = document.getElementById('user-dropdown-button');
	const logoutButton = document.getElementById('logout-button');
	const settingsButton = document.getElementById('settings-button');
	const modal = document.getElementById('login-modal');
	const modalClose = document.getElementById('login-modal-close');
	if (!loginButton || !dropdown || !dropdownButton || !logoutButton || !settingsButton) return;

	if (loginButton.dataset.authBound !== 'true') {
		loginButton.dataset.authBound = 'true';
		loginButton.addEventListener('click', openLoginModal);
	}
	if (dropdown.dataset.authBound !== 'true') {
		dropdown.dataset.authBound = 'true';
		dropdownButton.addEventListener('click', (event) => {
			event.stopPropagation();
			const expanded = dropdownButton.getAttribute('aria-expanded') === 'true';
			dropdownButton.setAttribute('aria-expanded', String(!expanded));
			document.getElementById('user-dropdown-menu')?.classList.toggle('opacity-0', expanded);
			document.getElementById('user-dropdown-menu')?.classList.toggle('invisible', expanded);
			document.getElementById('user-dropdown-menu')?.classList.toggle('opacity-100', !expanded);
			document.getElementById('user-dropdown-menu')?.classList.toggle('visible', !expanded);
		});
		logoutButton.addEventListener('click', async () => {
			closeDropdown();
			await logout();
			window.location.reload();
		});
		settingsButton.addEventListener('click', () => {
			closeDropdown();
			document.getElementById('settings-modal')?.dispatchEvent(new CustomEvent('open-settings'));
		});
	}
	if (modal && modalClose && modal.dataset.loginModalBound !== 'true') {
		modal.dataset.loginModalBound = 'true';
		modalClose.addEventListener('click', closeLoginModal);
	}
};

export const initHeaderAuth = async (): Promise<void> => {
	installDocumentBindings();
	bindHeaderElements();
	storeTokenFromHash();
	const loginButton = document.getElementById('auth-button');
	if (!loginButton) return;

	if (getToken()) {
		showUserDropdown();
		applyUserToUi({
			avatar: (document.getElementById('user-avatar') as HTMLImageElement | null)?.src || fallbackAvatar,
			username: document.getElementById('user-name')?.textContent || 'User',
		});
	}

	try {
		const user = await getUser();
		if (!loginButton.isConnected) return;
		if (user) {
			showUserDropdown();
			applyUserToUi(user);
			await refreshAdminEntry();
		} else if (getToken()) {
			// getUser 返回 null 但 token 仍在 = 网络抖动而非 401（401 会清 token）；
			// 保持现有界面，避免移动端把头像切成不可见的登录按钮。
		} else {
			showLoginButton();
		}
	} catch (error) {
		console.error('Auth error:', error);
		if (loginButton.isConnected && !getToken()) showLoginButton();
	}
};
