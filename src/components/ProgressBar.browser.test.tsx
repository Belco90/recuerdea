import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { ProgressBar } from './ProgressBar'

describe('ProgressBar', () => {
	it('renders nothing when inactive', async () => {
		await render(<ProgressBar active={false} />)
		await expect.element(page.getByRole('progressbar')).not.toBeInTheDocument()
	})

	it('shows an accessible loading bar when active', async () => {
		await render(<ProgressBar active />)
		await expect.element(page.getByRole('progressbar', { name: 'Cargando' })).toBeVisible()
	})
})
