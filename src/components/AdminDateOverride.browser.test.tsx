import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'

const { mockedNavigate } = vi.hoisted(() => ({
	mockedNavigate: vi.fn<(opts: { search: Record<string, unknown> }) => void>(),
}))

vi.mock('@tanstack/react-router', () => ({
	getRouteApi: () => ({
		useNavigate: () => mockedNavigate,
	}),
}))

const { AdminDateOverride } = await import('./AdminDateOverride')

describe('AdminDateOverride', () => {
	it('renders the admin badge', async () => {
		await render(<AdminDateOverride initialActiveDate={undefined} />)
		await expect.element(page.getByText('Solo admin')).toBeVisible()
	})

	it('shows the picker initialized with the active date', async () => {
		await render(<AdminDateOverride initialActiveDate="2024-07-15" />)
		await expect.element(page.getByText('Solo admin')).toBeVisible()
	})
})
