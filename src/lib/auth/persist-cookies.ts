// @netlify/identity writes nf_jwt and nf_refresh as session cookies (no Max-Age),
// so they vanish on tab close and the SSR auth gate redirects to /login on the
// next visit. Re-write them with an explicit Max-Age so the cookie survives.

const NF_JWT = 'nf_jwt'
const NF_REFRESH = 'nf_refresh'
const THIRTY_DAYS_S = 60 * 60 * 24 * 30

function readCookie(name: string): string | null {
	const match = document.cookie.match(
		new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`),
	)
	return match ? match[1] : null
}

function writePersistent(name: string, encodedValue: string): void {
	// Mirror @netlify/identity's attributes (path/secure/samesite) and add max-age.
	document.cookie = `${name}=${encodedValue}; path=/; secure; samesite=lax; max-age=${THIRTY_DAYS_S}`
}

export function persistAuthCookies(): void {
	if (typeof document === 'undefined') return
	const jwt = readCookie(NF_JWT)
	if (jwt) writePersistent(NF_JWT, jwt)
	const refresh = readCookie(NF_REFRESH)
	if (refresh) writePersistent(NF_REFRESH, refresh)
}
