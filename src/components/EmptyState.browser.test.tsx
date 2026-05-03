import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
	it('shows the empty heading and the day/month copy', async () => {
		await render(<EmptyState today={{ day: 7, month: 'julio' }} />)
		await expect.element(page.getByRole('heading', { name: 'Hoy, nada de nada.' })).toBeVisible()
		await expect.element(page.getByText(/7 de julio/)).toBeVisible()
	})
})
