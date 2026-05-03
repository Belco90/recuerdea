import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { Timeline } from './Timeline'

describe('Timeline', () => {
	it('renders its children and the trailing message', async () => {
		await render(
			<Timeline>
				<div>year section</div>
			</Timeline>,
		)
		await expect.element(page.getByText('year section')).toBeVisible()
		await expect.element(page.getByText('Vuelve mañana — habrá nuevos recuerdos.')).toBeVisible()
	})
})
