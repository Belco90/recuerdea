import type { YearGroup } from '#/lib/memories/memory-grouping'

import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { YearSection } from './YearSection'

const group: YearGroup = {
	year: 2023,
	yearsAgo: 3,
	items: [
		{
			kind: 'image',
			uuid: 'a',
			name: 'a.jpg',
			captureDate: '2023-05-03T10:00:00.000Z',
			width: 800,
			height: 600,
			place: 'Madrid',
			thumbUrl: 'https://example.test/thumb.jpg',
			lightboxUrl: 'https://example.test/lightbox.jpg',
		},
	],
}

describe('YearSection', () => {
	it('renders the years-ago heading and item count', async () => {
		await render(
			<YearSection group={group} onOpen={vi.fn<(year: number, idx: number) => void>()} />,
		)
		await expect.element(page.getByRole('heading', { name: /Hace 3 años/ })).toBeVisible()
		await expect.element(page.getByText('1 recuerdo')).toBeVisible()
	})
})
