import * as cookie from 'cookie';

export function parseCookies(header) {
	const parse = cookie.parse || cookie.parseCookie;
	if (!parse) throw new Error('cookie parser is unavailable');
	return parse(header || '');
}

export function serializeSetCookie(name, value, options) {
	if (cookie.serialize) return cookie.serialize(name, value, options);
	if (cookie.stringifySetCookie) return cookie.stringifySetCookie({ name, value, ...options });
	throw new Error('cookie serializer is unavailable');
}

export function appendSetCookie(res, name, value, options) {
	res.append('set-cookie', serializeSetCookie(name, value, options));
}
