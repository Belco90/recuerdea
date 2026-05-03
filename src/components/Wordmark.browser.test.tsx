import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { Wordmark } from './Wordmark'

describe('Wordmark', () => {
	it('renders the brand name', async () => {
		await render(<Wordmark />)
		await expect.element(page.getByText('ecuerdea')).toBeVisible()
	})
})
