import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { Hero } from './Hero'

describe('Hero', () => {
	it('renders the day, month and recuerdo count', async () => {
		await render(
			<Hero today={{ day: 12, month: 'mayo', year: 2026 }} totalItems={3} groupCount={2} />,
		)
		await expect.element(page.getByText('12')).toBeVisible()
		await expect.element(page.getByText('de mayo')).toBeVisible()
		await expect.element(page.getByText('3 recuerdos · 2 años')).toBeVisible()
	})

	it('shows the fallback label when there are no items', async () => {
		await render(
			<Hero today={{ day: 1, month: 'enero', year: 2026 }} totalItems={0} groupCount={0} />,
		)
		await expect.element(page.getByText('Hoy en tus recuerdos')).toBeVisible()
	})
})
