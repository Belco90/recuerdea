import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { AppShell } from './AppShell'

describe('AppShell', () => {
	it('renders its children', async () => {
		await render(
			<AppShell>
				<div>shell child</div>
			</AppShell>,
		)
		await expect.element(page.getByText('shell child')).toBeVisible()
	})
})
