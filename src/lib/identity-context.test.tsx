import type { User } from '@netlify/identity'

import { getUser, logout, onAuthChange } from '@netlify/identity'
import { describe, expect, it, vi } from 'vitest'
import { render, renderHook } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { IdentityProvider, useIdentity } from './identity-context'
import { hardNavigate } from './navigation'

vi.mock('./navigation', () => ({
	hardNavigate: vi.fn<(url: string) => unknown>(),
}))

const mockedGetUser = vi.mocked(getUser)
const mockedLogout = vi.mocked(logout)
const mockedOnAuthChange = vi.mocked(onAuthChange)
const mockedHardNavigate = vi.mocked(hardNavigate)

type AuthCallback = (event: string, user: User | null) => void

function setupNetlifyMocks() {
	let resolveGetUser: ((user: User | null) => void) | undefined
	const getUserPromise = new Promise<User | null>((res) => {
		resolveGetUser = res
	})
	mockedGetUser.mockReturnValue(getUserPromise as never)

	let authCb: AuthCallback | undefined
	const unsubscribe = vi.fn<() => void>()
	mockedOnAuthChange.mockImplementation((cb) => {
		authCb = cb as AuthCallback
		return unsubscribe
	})

	mockedLogout.mockResolvedValue(undefined as never)

	return {
		resolveGetUser: (u: User | null) => resolveGetUser?.(u),
		fireAuthChange: (event: string, u: User | null) => authCb?.(event, u),
		unsubscribe,
	}
}

function Consumer() {
	const identity = useIdentity()
	return (
		<div>
			<div>ready: {identity.ready ? 'true' : 'false'}</div>
			<div>user: {identity.user ? identity.user.email : 'none'}</div>
			<button type="button" onClick={() => void identity.logout()}>
				Log out
			</button>
		</div>
	)
}

describe('useIdentity', () => {
	it('throws when used outside IdentityProvider', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		await expect(renderHook(() => useIdentity())).rejects.toThrow(
			/useIdentity must be used within IdentityProvider/,
		)
		errorSpy.mockRestore()
	})
})

describe('IdentityProvider', () => {
	it('starts with ready=false and user=null while getUser is pending', async () => {
		setupNetlifyMocks()
		await render(
			<IdentityProvider>
				<Consumer />
			</IdentityProvider>,
		)
		await expect.element(page.getByText('ready: false')).toBeVisible()
		await expect.element(page.getByText('user: none')).toBeVisible()
	})

	it('flips to ready=true and shows the user after getUser resolves', async () => {
		const { resolveGetUser } = setupNetlifyMocks()
		await render(
			<IdentityProvider>
				<Consumer />
			</IdentityProvider>,
		)
		resolveGetUser({ id: 'u1', email: 'me@test.com' } as User)
		await expect.element(page.getByText('ready: true')).toBeVisible()
		await expect.element(page.getByText('user: me@test.com')).toBeVisible()
	})

	it('updates user when onAuthChange fires', async () => {
		const { resolveGetUser, fireAuthChange } = setupNetlifyMocks()
		await render(
			<IdentityProvider>
				<Consumer />
			</IdentityProvider>,
		)
		resolveGetUser(null)
		await expect.element(page.getByText('ready: true')).toBeVisible()

		fireAuthChange('login', { id: 'u2', email: 'new@test.com' } as User)
		await expect.element(page.getByText('user: new@test.com')).toBeVisible()
	})

	it('logout calls nfLogout and redirects to /login', async () => {
		const { resolveGetUser } = setupNetlifyMocks()
		await render(
			<IdentityProvider>
				<Consumer />
			</IdentityProvider>,
		)
		resolveGetUser({ id: 'u1', email: 'me@test.com' } as User)
		await expect.element(page.getByText('ready: true')).toBeVisible()

		await userEvent.click(page.getByRole('button', { name: /log out/i }))

		expect(mockedLogout).toHaveBeenCalledOnce()
		expect(mockedHardNavigate).toHaveBeenCalledWith('/login')
	})

	it('cleans up so unmount before getUser resolves does not update state', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const { resolveGetUser, unsubscribe } = setupNetlifyMocks()
		const screen = await render(
			<IdentityProvider>
				<Consumer />
			</IdentityProvider>,
		)
		await screen.unmount()
		expect(unsubscribe).toHaveBeenCalledOnce()
		resolveGetUser({ id: 'late', email: 'late@test.com' } as User)
		await new Promise((r) => setTimeout(r, 20))
		expect(errorSpy).not.toHaveBeenCalled()
		errorSpy.mockRestore()
	})
})
