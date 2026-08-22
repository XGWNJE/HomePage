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

export type AdminPageStatus = 'draft' | 'approved' | 'published' | 'archived';

export interface AdminPageSummary {
	slug: string;
	published_version_id: string | null;
	version_count: number;
	draft_count: number;
	title?: string;
	status?: AdminPageStatus;
	updated_at?: number;
}

export interface AdminPageRecord {
	slug: string;
	title?: string;
	status?: AdminPageStatus;
	published_version_id?: string | null;
	archived_at?: number | null;
	updated_at?: number;
}

export interface AdminPageVersion {
	id: string;
	sha256: string;
	status: AdminPageStatus;
	title?: string;
	metadata?: Record<string, unknown>;
	html?: string;
	review?: Record<string, unknown> | null;
	format_id?: string;
	preview_url?: string | null;
	created_at?: number;
	updated_at?: number;
}

export function getAdminPages(): Promise<{ items: AdminPageSummary[] }> {
	return adminRequest('/api/admin/pages');
}

export function getAdminPage(slug: string): Promise<{ page: AdminPageRecord; versions: AdminPageVersion[] }> {
	return adminRequest(`/api/admin/pages/${encodeURIComponent(slug)}`);
}

export function getAdminPageVersion(slug: string, versionId: string): Promise<{ version: AdminPageVersion }> {
	return adminRequest(`/api/admin/pages/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionId)}`);
}

export function approveAdminPageVersion(slug: string, versionId: string): Promise<{ ok: boolean }> {
	return adminRequest(`/api/admin/pages/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionId)}/approve`, {
		method: 'POST',
		body: JSON.stringify({}),
	});
}

export function publishAdminPageVersion(slug: string, versionId: string, sha256: string): Promise<{ ok: boolean }> {
	return adminRequest(`/api/admin/pages/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionId)}/publish`, {
		method: 'POST',
		body: JSON.stringify({ sha256 }),
	});
}

export function archiveAdminPage(slug: string): Promise<{ ok: boolean }> {
	return adminRequest(`/api/admin/pages/${encodeURIComponent(slug)}/archive`, {
		method: 'POST',
		body: JSON.stringify({}),
	});
}
