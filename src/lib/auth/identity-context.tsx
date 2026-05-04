import type { User } from '@netlify/identity'
import type { ReactNode } from 'react'

import { getUser, logout as nfLogout, onAuthChange } from '@netlify/identity'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { hardNavigate } from '../utils/navigation'
import { persistAuthCookies } from './persist-cookies'

type IdentityValue = {
	user: User | null
	ready: boolean
	logout: () => Promise<void>
}

const IdentityContext = createContext<IdentityValue | null>(null)

export function IdentityProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null)
	const [ready, setReady] = useState(false)

	useEffect(() => {
		let alive = true
		void getUser().then((u) => {
			if (!alive) return
			// SSR-side refresh writes session cookies via Set-Cookie; re-persist now
			// that they're in document.cookie so they survive the next tab close.
			if (u) persistAuthCookies()
			setUser(u)
			setReady(true)
		})
		const unsub = onAuthChange((event, u) => {
			if (!alive) return
			if (event === 'token_refresh' || event === 'login') persistAuthCookies()
			setUser(u)
		})
		return () => {
			alive = false
			unsub()
		}
	}, [])

	const logout = useCallback(async () => {
		await nfLogout()
		hardNavigate('/login')
	}, [])

	const value = useMemo(() => ({ user, ready, logout }), [user, ready, logout])

	return <IdentityContext value={value}>{children}</IdentityContext>
}

export function useIdentity(): IdentityValue {
	const ctx = useContext(IdentityContext)
	if (!ctx) throw new Error('useIdentity must be used within IdentityProvider')
	return ctx
}
