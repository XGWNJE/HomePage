import { API_BASE, TOKEN_KEY } from './config';

export interface User {
	id: string;
	username: string;
	avatar: string;
	login?: string;
	name?: string;
	profileUrl?: string;
}

/**
 * Read token from URL hash and store to localStorage
 */
export function storeTokenFromHash(): string | null {
	if (typeof window === 'undefined') return null;

	const hash = window.location.hash || '';
	const match = hash.match(/(?:^#|&)token=([^&]+)/);
	if (!match) return null;

	try {
		const token = decodeURIComponent(match[1]);
		localStorage.setItem(TOKEN_KEY, token);
		// Remove hash from URL
		history.replaceState(null, '', window.location.pathname);
		return token;
	} catch {
		return null;
	}
}

/**
 * Get authentication token from localStorage
 */
export function getToken(): string | null {
	if (typeof window === 'undefined') return null;
	storeTokenFromHash();
	return localStorage.getItem(TOKEN_KEY);
}

/**
 * Get current logged in user
 */
export async function getUser(): Promise<User | null> {
	const token = getToken();
	if (!token) return null;

	try {
		const response = await fetch(`${API_BASE}/api/me`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (!response.ok) {
			if (response.status === 401) {
				localStorage.removeItem(TOKEN_KEY);
			}
			return null;
		}

		const data = await response.json();
		const user = data?.user ?? data ?? null;
		if (!user || typeof user !== 'object') return null;

		return {
			id: user.id ?? '',
			username: user.username ?? user.name ?? user.login ?? '',
			avatar: user.avatar ?? user.avatarUrl ?? user.avatar_url ?? '',
			login: user.login ?? '',
			name: user.name ?? '',
			profileUrl: user.profileUrl ?? user.profile_url ?? '',
		};
	} catch {
		return null;
	}
}

/**
 * Logout current user
 */
export async function logout(): Promise<void> {
	const token = getToken();
	if (token) {
		try {
			await fetch(`${API_BASE}/api/auth/logout`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});
		} finally {
			localStorage.removeItem(TOKEN_KEY);
		}
	} else {
		localStorage.removeItem(TOKEN_KEY);
	}
}

/**
 * Send email login link
 */
export async function sendEmailLogin(email: string, turnstileToken?: string): Promise<{ ok: boolean; error?: string }> {
	try {
		const response = await fetch(`${API_BASE}/api/auth/email/send`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ email, turnstileToken }),
		});

		const data = await response.json();

		if (!response.ok) {
			return { ok: false, error: data.error ?? 'Failed to send email' };
		}

		return { ok: true };
	} catch (error) {
		return { ok: false, error: 'Network error' };
	}
}

/**
 * Send contact message
 */
export async function sendContactMessage(
	name: string,
	email: string,
	message: string,
	turnstileToken?: string
): Promise<{ ok: boolean; error?: string }> {
	try {
		const response = await fetch(`${API_BASE}/api/contact`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ name, email, message, turnstileToken }),
		});

		const data = await response.json();

		if (!response.ok) {
			return { ok: false, error: data.error ?? 'Failed to send message' };
		}

		return { ok: true };
	} catch {
		return { ok: false, error: 'Network error' };
	}
}

export async function updateProfileAvatar(avatarUrl: string): Promise<{ ok: boolean; user?: User; error?: string }> {
	const token = getToken();
	if (!token) {
		return { ok: false, error: 'Not logged in' };
	}

	try {
		const response = await fetch(`${API_BASE}/api/me`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ avatarUrl }),
		});

		const data = await response.json();
		if (!response.ok) {
			return { ok: false, error: data.error ?? 'Failed to update avatar' };
		}

		const user = data?.user ?? null;
		if (!user || typeof user !== 'object') {
			return { ok: false, error: 'Invalid user response' };
		}

		return {
			ok: true,
			user: {
				id: user.id ?? '',
				username: user.username ?? user.name ?? user.login ?? '',
				avatar: user.avatar ?? user.avatarUrl ?? user.avatar_url ?? '',
				login: user.login ?? '',
				name: user.name ?? '',
				profileUrl: user.profileUrl ?? user.profile_url ?? '',
			},
		};
	} catch {
		return { ok: false, error: 'Network error' };
	}
}

export async function updateProfileUsername(username: string): Promise<{ ok: boolean; user?: User; error?: string }> {
	const token = getToken();
	if (!token) {
		return { ok: false, error: 'Not logged in' };
	}

	try {
		const response = await fetch(`${API_BASE}/api/me`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ username }),
		});

		const data = await response.json();
		if (!response.ok) {
			return { ok: false, error: data.error ?? 'Failed to update username' };
		}

		const user = data?.user ?? null;
		if (!user || typeof user !== 'object') {
			return { ok: false, error: 'Invalid user response' };
		}

		return {
			ok: true,
			user: {
				id: user.id ?? '',
				username: user.username ?? user.name ?? user.login ?? '',
				avatar: user.avatar ?? user.avatarUrl ?? user.avatar_url ?? '',
				login: user.login ?? '',
				name: user.name ?? '',
				profileUrl: user.profileUrl ?? user.profile_url ?? '',
			},
		};
	} catch {
		return { ok: false, error: 'Network error' };
	}
}
