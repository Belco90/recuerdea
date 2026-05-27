import type { AdminMediaItem } from '#/lib/admin/folder-media.server'

import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { CollectionItemsGrid } from './CollectionItemsGrid'

const image2024: AdminMediaItem = {
	uuid: 'uuid-2024',
	kind: 'image',
	name: '2024.jpg',
	captureDate: '2024-04-27T14:30:00.000Z',
	fileid: 100,
	thumbUrl: 'https://example.test/thumb-2024.jpg',
}

const video2018: AdminMediaItem = {
	uuid: 'uuid-2018',
	kind: 'video',
	name: '2018.mp4',
	captureDate: '2018-04-27T10:00:00.000Z',
	fileid: 200,
	thumbUrl: 'https://example.test/thumb-2018.jpg',
}

describe('CollectionItemsGrid', () => {
	it('renders one tile per item with capture-year caption', async () => {
		await render(
			<CollectionItemsGrid items={[image2024, video2018]} onRemove={vi.fn<() => void>()} />,
		)
		await expect.element(page.getByText('2024')).toBeVisible()
		await expect.element(page.getByText('2018')).toBeVisible()
	})

	it('renders a "Quitar" button per tile and calls onRemove with the uuid', async () => {
		const onRemove = vi.fn<(uuid: string) => void>()
		await render(<CollectionItemsGrid items={[image2024]} onRemove={onRemove} />)
		await userEvent.click(page.getByRole('button', { name: /Quitar.*2024\.jpg/ }))
		expect(onRemove).toHaveBeenCalledWith('uuid-2024')
	})

	it('disables the Quitar button for items in the pending set', async () => {
		const onRemove = vi.fn<(uuid: string) => void>()
		await render(
			<CollectionItemsGrid
				items={[image2024]}
				pending={new Set(['uuid-2024'])}
				onRemove={onRemove}
			/>,
		)
		const btn = page
			.getByRole('button', { name: /Quitar.*2024\.jpg/ })
			.element() as HTMLButtonElement
		expect(btn.disabled).toBe(true)
	})

	it('marks video tiles with the VÍDEO badge', async () => {
		await render(<CollectionItemsGrid items={[video2018]} onRemove={vi.fn<() => void>()} />)
		await expect.element(page.getByText('VÍDEO')).toBeVisible()
	})
})
