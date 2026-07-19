import { getToken } from './auth';
import { API_BASE } from './config';

export interface AdminIdentity {
	isAdmin: boolean;
	email: string | null;
	login: string | null;
	permissions: {
		manageSubscriptions: boolean;
	};
}

export type SubscriptionKind = 'desktop' | 'mobile' | 'cmfa-import';

export interface SubscriptionStatus {
	ok: true;
	available: {
		desktop: boolean;
		mobile: boolean;
		mobileQr: boolean;
	};
	unlocked: boolean;
	expiresAt: number | null;
}

export interface SubscriptionUnlockResult {
	ok: true;
	unlocked: boolean;
	authorizeUrl?: string;
}

export interface AdminStats {
	total: number;
	pending: number;
	approved: number;
	rejected: number;
}

export interface AdminComment {
	id: string;
	post_slug: string;
	body: string;
	status: 'pending' | 'approved' | 'rejected';
	created_at: number;
	updated_at: number;
	login: string;
	name: string | null;
	avatar_url: string | null;
}

export interface AdminContactMessage {
	id: string;
	name: string;
	email: string;
	message: string;
	status: string;
	created_at: number;
}

export interface AdminOutboxItem {
	id: string;
	type: string;
	recipient: string | null;
	subject: string | null;
	body: string;
	status: string;
	created_at: number;
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const token = getToken();
	if (!token) throw new Error('Authentication required');

	const headers = new Headers(init.headers);
	headers.set('Authorization', `Bearer ${token}`);
	if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		headers,
		credentials: 'include',
		cache: 'no-store',
	});
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) throw new Error('Admin access required');
		throw new Error('Admin request failed');
	}
	return response;
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await adminFetch(path, init);
	return response.json() as Promise<T>;
}

export async function checkAdmin(): Promise<AdminIdentity> {
	const denied = { isAdmin: false, email: null, login: null, permissions: { manageSubscriptions: false } };
	if (!getToken()) return denied;
	try {
		const identity = await adminRequest<AdminIdentity>('/api/admin/check');
		return {
			...identity,
			permissions: { manageSubscriptions: Boolean(identity.permissions?.manageSubscriptions) },
		};
	} catch {
		return denied;
	}
}

export function getAdminStats(): Promise<AdminStats> {
	return adminRequest<AdminStats>('/api/admin/stats');
}

export function getAdminComments(status?: AdminComment['status'] | 'all'): Promise<{ comments: AdminComment[] }> {
	const query = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
	return adminRequest<{ comments: AdminComment[] }>(`/api/admin/comments${query}`);
}

export function approveComment(id: string): Promise<{ success: boolean; changes: number }> {
	return adminRequest('/api/admin/comment/approve', {
		method: 'POST',
		body: JSON.stringify({ id }),
	});
}

export function rejectComment(id: string): Promise<{ success: boolean; changes: number }> {
	return adminRequest('/api/admin/comment/reject', {
		method: 'POST',
		body: JSON.stringify({ id }),
	});
}

export function deleteComment(id: string): Promise<{ success: boolean; changes: number }> {
	return adminRequest(`/api/admin/comment?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getAdminContactMessages(): Promise<{ messages: AdminContactMessage[] }> {
	return adminRequest('/api/admin/contact-messages');
}

export function getAdminOutbox(): Promise<{ items: AdminOutboxItem[] }> {
	return adminRequest('/api/admin/outbox');
}

export function getSubscriptionStatus(): Promise<SubscriptionStatus> {
	return adminRequest('/api/admin/subscriptions/status');
}

export function beginSubscriptionUnlock(): Promise<SubscriptionUnlockResult> {
	return adminRequest('/api/admin/subscriptions/unlock', {
		method: 'POST',
		body: JSON.stringify({}),
	});
}

export function lockSubscriptionAccess(): Promise<{ ok: true; unlocked: false }> {
	return adminRequest('/api/admin/subscriptions/lock', {
		method: 'POST',
		body: JSON.stringify({}),
	});
}

export async function copySubscriptionValue(kind: SubscriptionKind): Promise<void> {
	const payload = await adminRequest<{ ok: true; kind: SubscriptionKind; value: string }>(
		'/api/admin/subscriptions/reveal',
		{ method: 'POST', body: JSON.stringify({ kind }) },
	);
	try {
		await navigator.clipboard.writeText(payload.value);
	} finally {
		payload.value = '';
	}
}

export async function createSubscriptionQrObjectUrl(): Promise<string> {
	const response = await adminFetch('/api/admin/subscriptions/mobile-qr');
	const blob = await response.blob();
	if (blob.type !== 'image/png') throw new Error('Admin request failed');
	return URL.createObjectURL(blob);
}

export function revokeSubscriptionQrObjectUrl(url: string | null): void {
	if (url) URL.revokeObjectURL(url);
}

export interface AdminArticle {
	id: string;
	file: string;
	format: 'md' | 'mdx';
	title: string;
	lang: string;
	group: string;
	draft: boolean;
	pubDate: string;
	category: string;
	tags: string;
}

export interface AdminArticleDetail {
	id: string;
	file: string;
	format: 'md' | 'mdx';
	frontmatter: Record<string, string>;
	source: string;
}

export interface AdminArticleDeleteResult {
	ok: boolean;
	deleted: string[];
	release: { releaseId?: string; seconds?: number };
}

export function getAdminArticles(): Promise<{ articles: AdminArticle[]; sync: boolean }> {
	return adminRequest('/api/admin/articles');
}

export function getAdminArticle(id: string): Promise<AdminArticleDetail> {
	return adminRequest(`/api/admin/article?id=${encodeURIComponent(id)}`);
}

export function deleteAdminArticle(id: string, pair: boolean): Promise<AdminArticleDeleteResult> {
	const query = pair ? '&pair=1' : '';
	return adminRequest(`/api/admin/article?id=${encodeURIComponent(id)}${query}`, { method: 'DELETE' });
}
