import type { AdminFileItem } from '#/lib/admin/collection.server'

import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { AdminCollectionGrid } from './AdminCollectionGrid'

const itemA: AdminFileItem = {
	uuid: 'uuid-A',
	name: 'a.jpg',
	kind: 'image',
	thumbUrl: 'https://example.test/a.jpg',
}

const itemB: AdminFileItem = {
	uuid: 'uuid-B',
	name: 'b.mp4',
	kind: 'video',
	thumbUrl: 'https://example.test/b.jpg',
}

const itemC: AdminFileItem = {
	uuid: 'uuid-C',
	name: 'c.jpg',
	kind: 'image',
	thumbUrl: 'https://example.test/c.jpg',
}

describe('AdminCollectionGrid', () => {
	it('renders one tile per item with the file name as caption', async () => {
		await render(
			<AdminCollectionGrid
				items={[itemA, itemB]}
				picked={new Set()}
				blocked={new Set()}
				onToggle={vi.fn<() => void>()}
				onSave={vi.fn<() => void>()}
				onCancel={vi.fn<() => void>()}
			/>,
		)
		await expect.element(page.getByText('a.jpg')).toBeVisible()
		await expect.element(page.getByText('b.mp4')).toBeVisible()
	})

	it('forwards uuid on tile click', async () => {
		const onToggle = vi.fn<(uuid: string) => void>()
		await render(
			<AdminCollectionGrid
				items={[itemA]}
				picked={new Set()}
				blocked={new Set()}
				onToggle={onToggle}
				onSave={vi.fn<() => void>()}
				onCancel={vi.fn<() => void>()}
			/>,
		)
		await userEvent.click(page.getByRole('button', { name: /Seleccionar.*a\.jpg/ }))
		expect(onToggle).toHaveBeenCalledWith('uuid-A')
	})

	it('marks blocked tiles with aria-disabled and ignores clicks', async () => {
		const onToggle = vi.fn<(uuid: string) => void>()
		await render(
			<AdminCollectionGrid
				items={[itemA, itemB]}
				picked={new Set()}
				blocked={new Set(['uuid-A'])}
				onToggle={onToggle}
				onSave={vi.fn<() => void>()}
				onCancel={vi.fn<() => void>()}
			/>,
		)
		const tile = page
			.getByRole('button', { name: /Seleccionar.*a\.jpg/ })
			.element() as HTMLButtonElement
		expect(tile.getAttribute('aria-disabled')).toBe('true')
		tile.click()
		expect(onToggle).not.toHaveBeenCalled()
	})

	it('hides the save/cancel footer when picked is empty', async () => {
		await render(
			<AdminCollectionGrid
				items={[itemA]}
				picked={new Set()}
				blocked={new Set()}
				onToggle={vi.fn<() => void>()}
				onSave={vi.fn<() => void>()}
				onCancel={vi.fn<() => void>()}
			/>,
		)
		await expect.element(page.getByRole('button', { name: /Guardar/ })).not.toBeInTheDocument()
	})

	it('shows Guardar (N) and forwards picked uuids', async () => {
		const onSave = vi.fn<(uuids: readonly string[]) => void>()
		await render(
			<AdminCollectionGrid
				items={[itemA, itemB, itemC]}
				picked={new Set(['uuid-A', 'uuid-C'])}
				blocked={new Set()}
				onToggle={vi.fn<() => void>()}
				onSave={onSave}
				onCancel={vi.fn<() => void>()}
			/>,
		)
		await userEvent.click(page.getByRole('button', { name: /Guardar \(2\)/ }))
		expect(onSave).toHaveBeenCalledTimes(1)
		expect(new Set(onSave.mock.calls[0]![0])).toEqual(new Set(['uuid-A', 'uuid-C']))
	})

	it('disables Guardar while saving', async () => {
		await render(
			<AdminCollectionGrid
				items={[itemA]}
				picked={new Set(['uuid-A'])}
				blocked={new Set()}
				onToggle={vi.fn<() => void>()}
				onSave={vi.fn<() => void>()}
				onCancel={vi.fn<() => void>()}
				saving
			/>,
		)
		const btn = page
			.getByRole('button', { name: /Guardar|Guardando/ })
			.element() as HTMLButtonElement
		expect(btn.disabled).toBe(true)
	})
})
