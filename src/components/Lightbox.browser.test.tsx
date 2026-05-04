import type { YearGroup } from '#/lib/memories/memory-grouping'

import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'

vi.mock('#/lib/memories/get-download-url', () => ({
	getMediaDownloadUrl:
		vi.fn<typeof import('#/lib/memories/get-download-url').getMediaDownloadUrl>(),
}))

vi.mock('#/lib/memories/download', () => ({
	downloadAs: vi.fn<typeof import('#/lib/memories/download').downloadAs>(),
}))

const { Lightbox } = await import('./Lightbox')

const group: YearGroup = {
	year: 2022,
	yearsAgo: 4,
	items: [
		{
			kind: 'image',
			uuid: 'a',
			name: 'a.jpg',
			captureDate: '2022-05-03T10:00:00.000Z',
			width: 1024,
			height: 768,
			place: 'Lisboa',
			thumbUrl: 'https://example.test/thumb.jpg',
			lightboxUrl: 'https://example.test/lightbox.jpg',
		},
		{
			kind: 'image',
			uuid: 'b',
			name: 'b.jpg',
			captureDate: '2022-05-03T11:00:00.000Z',
			width: 800,
			height: 600,
			place: null,
			thumbUrl: 'https://example.test/thumb-b.jpg',
			lightboxUrl: 'https://example.test/lightbox-b.jpg',
		},
	],
}

describe('Lightbox', () => {
	it('renders the year header and slide counter when open', async () => {
		await render(<Lightbox group={group} startIndex={0} open onClose={vi.fn<() => void>()} />)
		await expect.element(page.getByText('hace 4 años')).toBeVisible()
		await expect.element(page.getByText('1 / 2')).toBeVisible()
		await expect.element(page.getByRole('button', { name: 'Cerrar' })).toBeVisible()
	})

	it('renders nothing visible when closed', async () => {
		await render(
			<Lightbox group={group} startIndex={0} open={false} onClose={vi.fn<() => void>()} />,
		)
		await expect.element(page.getByText('1 / 2')).not.toBeInTheDocument()
	})
})
