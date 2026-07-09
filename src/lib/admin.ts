const API_BASE = import.meta.env.DEV
	? 'http://localhost:8787'
	: 'https://api.xgwnje.cn';

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

export async function getAdminStats(): Promise<AdminStats> {
	const res = await fetch(`${API_BASE}/api/admin/stats`, {
		headers: { 'CF-Access-Authenticated-User-Email': 'admin@placeholder.com' }
	});
	if (!res.ok) throw new Error('Failed to fetch stats');
	return res.json();
}

export async function getAdminComments(status?: string): Promise<{ comments: AdminComment[] }> {
	const url = new URL(`${API_BASE}/api/admin/comments`);
	if (status && status !== 'all') url.searchParams.set('status', status);
	const res = await fetch(url.toString(), {
		headers: { 'CF-Access-Authenticated-User-Email': 'admin@placeholder.com' }
	});
	if (!res.ok) throw new Error('Failed to fetch comments');
	return res.json();
}

export async function approveComment(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`${API_BASE}/api/admin/comment/approve`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'CF-Access-Authenticated-User-Email': 'admin@placeholder.com'
		},
		body: JSON.stringify({ id })
	});
	if (!res.ok) throw new Error('Failed to approve comment');
	return res.json();
}

export async function rejectComment(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`${API_BASE}/api/admin/comment/reject`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'CF-Access-Authenticated-User-Email': 'admin@placeholder.com'
		},
		body: JSON.stringify({ id })
	});
	if (!res.ok) throw new Error('Failed to reject comment');
	return res.json();
}

export async function deleteComment(id: string): Promise<{ success: boolean }> {
	const res = await fetch(`${API_BASE}/api/admin/comment?id=${encodeURIComponent(id)}`, {
		method: 'DELETE',
		headers: {
			'CF-Access-Authenticated-User-Email': 'admin@placeholder.com'
		}
	});
	if (!res.ok) throw new Error('Failed to delete comment');
	return res.json();
}

export async function checkAdmin(): Promise<{ isAdmin: boolean; email: string | null }> {
	// Note: This requires Cloudflare Access policy on api.xgwnje.cn
	// Cloudflare Access injects CF-Access-Authenticated-User-Email header
	// when the user has an active Access session.
	// Do NOT override this header - let Cloudflare inject the real value.
	try {
		const res = await fetch(`${API_BASE}/api/admin/check`, {
			credentials: 'include'
		});
		if (!res.ok) return { isAdmin: false, email: null };
		return res.json();
	} catch {
		return { isAdmin: false, email: null };
	}
}
