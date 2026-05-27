import type { AdminMediaItem } from '#/lib/admin/folder-media.server'

import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { AdminCollectionGrid } from './AdminCollectionGrid'

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

const undated: AdminMediaItem = {
	uuid: 'uuid-undated',
	kind: 'image',
	name: 'undated.jpg',
	captureDate: null,
	fileid: 300,
	thumbUrl: 'https://example.test/thumb-undated.jpg',
}

describe('AdminCollectionGrid', () => {
	it('renders one tile per item with capture year caption', async () => {
		await render(
			<AdminCollectionGrid items={[image2024, video2018]} onToggle={vi.fn<() => void>()} />,
		)
		await expect.element(page.getByText('2024')).toBeVisible()
		await expect.element(page.getByText('2018')).toBeVisible()
	})

	it('marks video tiles with the VÍDEO badge', async () => {
		await render(<AdminCollectionGrid items={[video2018]} onToggle={vi.fn<() => void>()} />)
		await expect.element(page.getByText('VÍDEO')).toBeVisible()
	})

	it('falls back to "sin fecha" caption when captureDate is null', async () => {
		await render(<AdminCollectionGrid items={[undated]} onToggle={vi.fn<() => void>()} />)
		await expect.element(page.getByText('sin fecha')).toBeVisible()
	})

	it('uses lazy-loaded images', async () => {
		const screen = await render(
			<AdminCollectionGrid items={[image2024]} onToggle={vi.fn<() => void>()} />,
		)
		const img = screen.container.querySelector('img[src="https://example.test/thumb-2024.jpg"]')
		expect(img?.getAttribute('loading')).toBe('lazy')
	})

	it('calls onToggle with the uuid when a tile is clicked', async () => {
		const onToggle = vi.fn<(uuid: string) => void>()
		await render(<AdminCollectionGrid items={[image2024]} onToggle={onToggle} />)
		await userEvent.click(page.getByRole('button', { name: /2024\.jpg/ }))
		expect(onToggle).toHaveBeenCalledWith('uuid-2024')
	})

	it('shows a checkmark on selected tiles', async () => {
		await render(
			<AdminCollectionGrid
				items={[image2024, video2018]}
				selected={new Set(['uuid-2024'])}
				onToggle={vi.fn<() => void>()}
			/>,
		)
		const selectedTile = page.getByRole('button', { name: /2024\.jpg/ }).element()
		expect(selectedTile.getAttribute('aria-pressed')).toBe('true')
		const unselectedTile = page.getByRole('button', { name: /2018\.mp4/ }).element()
		expect(unselectedTile.getAttribute('aria-pressed')).toBe('false')
	})

	it('disables tiles in the disabled set and does not call onToggle when clicked', async () => {
		const onToggle = vi.fn<(uuid: string) => void>()
		await render(
			<AdminCollectionGrid
				items={[image2024]}
				disabled={new Set(['uuid-2024'])}
				onToggle={onToggle}
			/>,
		)
		const tile = page.getByRole('button', { name: /2024\.jpg/ }).element() as HTMLButtonElement
		expect(tile.disabled).toBe(true)
		await userEvent.click(tile, { force: true })
		expect(onToggle).not.toHaveBeenCalled()
	})
})
