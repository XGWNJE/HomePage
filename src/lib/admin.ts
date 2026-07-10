import { getToken } from './auth';
import { API_BASE } from './config';

export interface AdminIdentity {
	isAdmin: boolean;
	email: string | null;
	login: string | null;
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

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
	const token = getToken();
	if (!token) throw new Error('Authentication required');

	const headers = new Headers(init.headers);
	headers.set('Authorization', `Bearer ${token}`);
	if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

	const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) throw new Error('Admin access required');
		throw new Error('Admin request failed');
	}
	return response.json() as Promise<T>;
}

export async function checkAdmin(): Promise<AdminIdentity> {
	if (!getToken()) return { isAdmin: false, email: null, login: null };
	try {
		return await adminRequest<AdminIdentity>('/api/admin/check');
	} catch {
		return { isAdmin: false, email: null, login: null };
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
