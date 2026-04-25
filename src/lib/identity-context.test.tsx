import { type User, getUser, logout, onAuthChange } from '@netlify/identity'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { IdentityProvider, useIdentity } from './identity-context'
import { navigateTo } from './navigation'

vi.mock('@netlify/identity', () => ({
	getUser: vi.fn<() => unknown>(),
	logout: vi.fn<() => unknown>(),
	onAuthChange: vi.fn<() => unknown>(),
}))

vi.mock('./navigation', () => ({
	navigateTo: vi.fn<() => unknown>(),
}))

const mockedGetUser = vi.mocked(getUser)
const mockedLogout = vi.mocked(logout)
const mockedOnAuthChange = vi.mocked(onAuthChange)
const mockedNavigateTo = vi.mocked(navigateTo)

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
	beforeEach(() => {
		mockedGetUser.mockReset()
		mockedLogout.mockReset()
		mockedOnAuthChange.mockReset()
	})

	it('throws when used outside IdentityProvider', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		await expect(renderHook(() => useIdentity())).rejects.toThrow(
			/useIdentity must be used within IdentityProvider/,
		)
		errorSpy.mockRestore()
	})
})

describe('IdentityProvider', () => {
	beforeEach(() => {
		mockedGetUser.mockReset()
		mockedLogout.mockReset()
		mockedOnAuthChange.mockReset()
		mockedNavigateTo.mockReset()
	})

	it('starts with ready=false and user=null while getUser is pending', async () => {
		setupNetlifyMocks()
		await render(
			<IdentityProvider>
				<Consumer />
			</IdentityProvider>,
		)
		await expect.element(page.getByText('ready: false')).toBeInTheDocument()
		await expect.element(page.getByText('user: none')).toBeInTheDocument()
	})

	it('flips to ready=true and shows the user after getUser resolves', async () => {
		const { resolveGetUser } = setupNetlifyMocks()
		await render(
			<IdentityProvider>
				<Consumer />
			</IdentityProvider>,
		)
		resolveGetUser({ id: 'u1', email: 'me@x.com' } as User)
		await expect.element(page.getByText('ready: true')).toBeInTheDocument()
		await expect.element(page.getByText('user: me@x.com')).toBeInTheDocument()
	})

	it('updates user when onAuthChange fires', async () => {
		const { resolveGetUser, fireAuthChange } = setupNetlifyMocks()
		await render(
			<IdentityProvider>
				<Consumer />
			</IdentityProvider>,
		)
		resolveGetUser(null)
		await expect.element(page.getByText('ready: true')).toBeInTheDocument()

		fireAuthChange('login', { id: 'u2', email: 'new@x.com' } as User)
		await expect.element(page.getByText('user: new@x.com')).toBeInTheDocument()
	})

	it('logout calls nfLogout and redirects to /login', async () => {
		const { resolveGetUser } = setupNetlifyMocks()
		await render(
			<IdentityProvider>
				<Consumer />
			</IdentityProvider>,
		)
		resolveGetUser({ id: 'u1', email: 'me@x.com' } as User)
		await expect.element(page.getByText('ready: true')).toBeInTheDocument()

		await userEvent.click(page.getByRole('button', { name: /log out/i }))

		expect(mockedLogout).toHaveBeenCalledOnce()
		expect(mockedNavigateTo).toHaveBeenCalledWith('/login')
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
		resolveGetUser({ id: 'late', email: 'late@x.com' } as User)
		await new Promise((r) => setTimeout(r, 20))
		expect(errorSpy).not.toHaveBeenCalled()
		errorSpy.mockRestore()
	})
})
