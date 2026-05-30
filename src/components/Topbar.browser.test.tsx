import type { ReactNode } from 'react'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'

const { mockedLogout, mockedIdentity } = vi.hoisted(() => ({
	mockedLogout: vi.fn<() => Promise<void>>(),
	mockedIdentity: vi.fn<() => unknown>(),
}))

vi.mock('#/lib/auth/identity-context', () => ({
	useIdentity: () => mockedIdentity(),
}))

vi.mock('@tanstack/react-router', () => ({
	ClientOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
	Link: ({ children, to }: { children: ReactNode; to?: string }) => (
		<a href={to ?? '#'}>{children}</a>
	),
}))

const { Topbar } = await import('./Topbar')

beforeEach(() => {
	mockedIdentity.mockReturnValue({
		user: { name: 'Mario Tester', email: 'me@test.com' },
		ready: true,
		isAdmin: false,
		logout: mockedLogout,
	})
})

describe('Topbar', () => {
	it('opens an account drawer showing name, email, and a logout button', async () => {
		await render(<Topbar />)
		await userEvent.click(page.getByRole('button', { name: 'Abrir menú de cuenta' }))
		await expect.element(page.getByText('Mario Tester')).toBeVisible()
		await expect.element(page.getByText('me@test.com')).toBeVisible()
		await expect.element(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
	})

	it('invokes logout when the drawer logout button is clicked', async () => {
		mockedLogout.mockResolvedValue(undefined)
		await render(<Topbar />)
		await userEvent.click(page.getByRole('button', { name: 'Abrir menú de cuenta' }))
		await userEvent.click(page.getByRole('button', { name: 'Cerrar sesión' }))
		expect(mockedLogout).toHaveBeenCalledOnce()
	})

	it('shows an "Administración" link in the drawer when the user is admin', async () => {
		mockedIdentity.mockReturnValue({
			user: { name: 'Mario Tester', email: 'me@test.com' },
			ready: true,
			isAdmin: true,
			logout: mockedLogout,
		})
		await render(<Topbar />)
		await userEvent.click(page.getByRole('button', { name: 'Abrir menú de cuenta' }))
		await expect.element(page.getByRole('link', { name: 'Administración' })).toBeVisible()
	})

	it('hides the "Administración" link when the user is not admin', async () => {
		mockedIdentity.mockReturnValue({
			user: { name: 'Mario Tester', email: 'me@test.com' },
			ready: true,
			isAdmin: false,
			logout: mockedLogout,
		})
		await render(<Topbar />)
		await userEvent.click(page.getByRole('button', { name: 'Abrir menú de cuenta' }))
		await expect.element(page.getByText('me@test.com')).toBeVisible()
		expect(page.getByRole('link', { name: 'Administración' }).query()).toBeNull()
	})
})
