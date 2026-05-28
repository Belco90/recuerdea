import type { CollectionItem } from '#/lib/admin/collection.server'

import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { CollectionItemsGrid } from './CollectionItemsGrid'

const imageItem: CollectionItem = {
	uuid: 'uuid-A',
	fileid: 100,
	name: '2024.jpg',
	kind: 'image',
	thumbUrl: 'https://example.test/thumb-2024.jpg',
}

const videoItem: CollectionItem = {
	uuid: 'uuid-B',
	fileid: 200,
	name: '2018.mp4',
	kind: 'video',
	thumbUrl: 'https://example.test/thumb-2018.jpg',
}

const itemMissingThumb: CollectionItem = {
	uuid: 'uuid-C',
	fileid: 300,
	name: 'noThumb.jpg',
	kind: 'image',
	thumbUrl: null,
}

describe('CollectionItemsGrid', () => {
	it('renders one tile per item with the file name as caption', async () => {
		await render(
			<CollectionItemsGrid items={[imageItem, videoItem]} onRemove={vi.fn<() => void>()} />,
		)
		await expect.element(page.getByText('2024.jpg')).toBeVisible()
		await expect.element(page.getByText('2018.mp4')).toBeVisible()
	})

	it('renders a "Quitar" button per tile and calls onRemove with the uuid', async () => {
		const onRemove = vi.fn<(uuid: string) => void>()
		await render(<CollectionItemsGrid items={[imageItem]} onRemove={onRemove} />)
		await userEvent.click(page.getByRole('button', { name: /Quitar.*2024\.jpg/ }))
		expect(onRemove).toHaveBeenCalledWith('uuid-A')
	})

	it('disables the Quitar button for items in the pending set', async () => {
		const onRemove = vi.fn<(uuid: string) => void>()
		await render(
			<CollectionItemsGrid items={[imageItem]} pending={new Set(['uuid-A'])} onRemove={onRemove} />,
		)
		const btn = page
			.getByRole('button', { name: /Quitar.*2024\.jpg/ })
			.element() as HTMLButtonElement
		expect(btn.disabled).toBe(true)
	})

	it('marks video tiles with the VÍDEO badge', async () => {
		await render(<CollectionItemsGrid items={[videoItem]} onRemove={vi.fn<() => void>()} />)
		await expect.element(page.getByText('VÍDEO')).toBeVisible()
	})

	it('renders a fallback box when thumbUrl is null', async () => {
		await render(<CollectionItemsGrid items={[itemMissingThumb]} onRemove={vi.fn<() => void>()} />)
		await expect.element(page.getByText('sin miniatura')).toBeVisible()
	})
})
