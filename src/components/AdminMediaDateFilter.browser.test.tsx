import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { AdminMediaDateFilter } from './AdminMediaDateFilter'

describe('AdminMediaDateFilter', () => {
	it('renders the Fecha label and calendar input', async () => {
		await render(
			<AdminMediaDateFilter
				value={undefined}
				onChange={vi.fn<(d: string | undefined) => void>()}
			/>,
		)
		await expect.element(page.getByText('Fecha:')).toBeVisible()
		await expect.element(page.getByPlaceholder('Cualquier fecha')).toBeVisible()
	})

	it('shows the selected day in the input', async () => {
		await render(
			<AdminMediaDateFilter
				value="2026-05-15"
				onChange={vi.fn<(d: string | undefined) => void>()}
			/>,
		)
		const input = page.getByPlaceholder('Cualquier fecha').element() as HTMLInputElement
		expect(input.value).toContain('2026')
	})

	it('does not render the Hoy/Mañana presets (they are now tabs)', async () => {
		await render(
			<AdminMediaDateFilter
				value={undefined}
				onChange={vi.fn<(d: string | undefined) => void>()}
			/>,
		)
		expect(page.getByRole('button', { name: 'Hoy' }).query()).toBeNull()
		expect(page.getByRole('button', { name: 'Mañana' }).query()).toBeNull()
	})
})
