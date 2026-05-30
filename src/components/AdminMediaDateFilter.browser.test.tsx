import { todayLocal, tomorrowLocal } from '#/lib/admin/date-filter'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { AdminMediaDateFilter } from './AdminMediaDateFilter'

describe('AdminMediaDateFilter', () => {
	it('renders the presets', async () => {
		await render(
			<AdminMediaDateFilter
				value={undefined}
				onChange={vi.fn<(d: string | undefined) => void>()}
			/>,
		)
		await expect.element(page.getByRole('button', { name: 'Hoy' })).toBeVisible()
		await expect.element(page.getByRole('button', { name: 'Mañana' })).toBeVisible()
	})

	it('Hoy fires onChange with today', async () => {
		const onChange = vi.fn<(d: string | undefined) => void>()
		await render(<AdminMediaDateFilter value={undefined} onChange={onChange} />)
		await userEvent.click(page.getByRole('button', { name: 'Hoy' }))
		expect(onChange).toHaveBeenCalledWith(todayLocal())
	})

	it('Mañana fires onChange with tomorrow', async () => {
		const onChange = vi.fn<(d: string | undefined) => void>()
		await render(<AdminMediaDateFilter value={undefined} onChange={onChange} />)
		await userEvent.click(page.getByRole('button', { name: 'Mañana' }))
		expect(onChange).toHaveBeenCalledWith(tomorrowLocal())
	})

	it('clicking the active preset toggles the filter off', async () => {
		const onChange = vi.fn<(d: string | undefined) => void>()
		await render(<AdminMediaDateFilter value={todayLocal()} onChange={onChange} />)
		await userEvent.click(page.getByRole('button', { name: 'Hoy' }))
		expect(onChange).toHaveBeenCalledWith(undefined)
	})
})
