import type { User } from '@netlify/identity'
import type { ReactNode } from 'react'

import { getUser, logout as nfLogout, onAuthChange } from '@netlify/identity'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { hardNavigate } from '../utils/navigation'

type IdentityValue = {
	user: User | null
	ready: boolean
	isAdmin: boolean
	logout: () => Promise<void>
}

function deriveIsAdmin(user: User | null): boolean {
	if (!user) return false
	return user.role === 'admin' || (user.roles?.includes('admin') ?? false)
}

const IdentityContext = createContext<IdentityValue | null>(null)

export function IdentityProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null)
	const [ready, setReady] = useState(false)

	useEffect(() => {
		let alive = true
		void getUser().then((u) => {
			if (!alive) return
			setUser(u)
			setReady(true)
		})
		const unsub = onAuthChange((_event, u) => {
			if (alive) setUser(u)
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

	const value = useMemo(
		() => ({ user, ready, isAdmin: deriveIsAdmin(user), logout }),
		[user, ready, logout],
	)

	return <IdentityContext value={value}>{children}</IdentityContext>
}

export function useIdentity(): IdentityValue {
	const ctx = useContext(IdentityContext)
	if (!ctx) throw new Error('useIdentity must be used within IdentityProvider')
	return ctx
}
