import type { ReactNode } from 'react'

import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'

const { mockedLogout } = vi.hoisted(() => ({
	mockedLogout: vi.fn<() => Promise<void>>(),
}))

vi.mock('#/lib/auth/identity-context', () => ({
	useIdentity: () => ({
		user: { name: 'Mario Tester', email: 'me@test.com' },
		ready: true,
		logout: mockedLogout,
	}),
}))

vi.mock('@tanstack/react-router', () => ({
	ClientOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
	Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}))

const { Topbar } = await import('./Topbar')

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
})
