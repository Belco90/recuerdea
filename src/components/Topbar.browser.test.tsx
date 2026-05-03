import type { ReactNode } from 'react'

import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'

const { mockedLogout, mockedUseRouteContext } = vi.hoisted(() => ({
	mockedLogout: vi.fn<() => Promise<void>>(),
	mockedUseRouteContext: vi.fn<() => { user: { email: string | null } }>(),
}))

vi.mock('#/lib/auth/identity-context', () => ({
	useIdentity: () => ({
		user: { email: 'me@test.com' },
		ready: true,
		logout: mockedLogout,
	}),
}))

vi.mock('@tanstack/react-router', () => ({
	getRouteApi: () => ({
		useRouteContext: mockedUseRouteContext,
	}),
	Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}))

const { Topbar } = await import('./Topbar')

describe('Topbar', () => {
	it('renders the logged-in email and a logout button', async () => {
		mockedUseRouteContext.mockReturnValue({ user: { email: 'me@test.com' } })
		await render(<Topbar />)
		// Email text is hidden below the `sm` breakpoint, so check it's in the
		// DOM (carried by Avatar.Fallback's `name`) rather than visible.
		await expect.element(page.getByText('me@test.com', { exact: false })).toBeInTheDocument()
		await expect.element(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
	})

	it('invokes logout when the button is clicked', async () => {
		mockedUseRouteContext.mockReturnValue({ user: { email: 'me@test.com' } })
		mockedLogout.mockResolvedValue(undefined)
		await render(<Topbar />)
		await userEvent.click(page.getByRole('button', { name: 'Cerrar sesión' }))
		expect(mockedLogout).toHaveBeenCalledOnce()
	})
})
