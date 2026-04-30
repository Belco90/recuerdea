import { getUser } from '@netlify/identity'
import { getCookie } from '@tanstack/react-start/server'

export type ServerUser = { id: string; email?: string; isAdmin: boolean }
type JwtClaims = {
	sub: string
	email?: string
	exp?: number
	app_metadata?: { roles?: string[] }
}

// Local dev only; whole `if (DEV)` branch in loadServerUser is stripped in prod.
function decodeJwt(token: string): JwtClaims | null {
	try {
		const [, payload] = token.split('.')
		if (!payload) return null
		const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
		const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
		const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
		const claims = JSON.parse(new TextDecoder().decode(bytes)) as JwtClaims
		if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null
		return claims
	} catch {
		return null
	}
}

function hasAdminRole(input: { role?: string; roles?: string[] }): boolean {
	return input.role === 'admin' || (input.roles?.includes('admin') ?? false)
}

export async function loadServerUser(): Promise<ServerUser | null> {
	const user = await getUser()
	if (user) {
		return { id: user.id, email: user.email, isAdmin: hasAdminRole(user) }
	}
	// Dev fallback: `netlify dev` proxies SSR to Vite, which runs outside the
	// Netlify Functions runtime, so `getUser()` can't reach `globalThis.Netlify.context.cookies`.
	// Decode the JWT ourselves. Dead code in prod via `import.meta.env.DEV`.
	if (!import.meta.env.DEV) return null
	const jwt = getCookie('nf_jwt')
	if (!jwt) return null
	const claims = decodeJwt(jwt)
	if (!claims) return null
	return {
		id: claims.sub,
		email: claims.email,
		isAdmin: claims.app_metadata?.roles?.includes('admin') ?? false,
	}
}
