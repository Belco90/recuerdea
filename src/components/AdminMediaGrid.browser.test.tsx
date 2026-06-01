import type { SourceFileItem } from '#/lib/admin/source-folder.server'

import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { EmptyMedia, FileGrid, StickyFooter } from './AdminMediaGrid'

const files: SourceFileItem[] = [
	{
		fileid: 100,
		name: 'photo.jpg',
		kind: 'image',
		thumbUrl: 'https://example.test/thumb-100.jpg',
		created: '2024-04-15T10:00:00.000Z',
	},
	{
		fileid: 200,
		name: 'clip.mp4',
		kind: 'video',
		thumbUrl: 'https://example.test/thumb-200.jpg',
		created: '2024-04-15T11:00:00.000Z',
	},
]

const gridProps = {
	files,
	picked: new Set<number>(),
	blocked: new Set<number>(),
	onToggle: vi.fn<(item: SourceFileItem) => void>(),
}

describe('FileGrid', () => {
	it('fires onToggle with the file item on click', async () => {
		const onToggle = vi.fn<(item: SourceFileItem) => void>()
		await render(<FileGrid {...gridProps} onToggle={onToggle} />)
		await userEvent.click(page.getByRole('button', { name: /Seleccionar.*photo\.jpg/ }))
		expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ fileid: 100 }))
	})

	it('marks a picked tile as aria-pressed', async () => {
		await render(<FileGrid {...gridProps} picked={new Set([100])} />)
		const btn = page
			.getByRole('button', { name: /Seleccionar.*photo\.jpg/ })
			.element() as HTMLButtonElement
		expect(btn.getAttribute('aria-pressed')).toBe('true')
	})

	it('blocked tile is aria-disabled and does not toggle on click', async () => {
		const onToggle = vi.fn<(item: SourceFileItem) => void>()
		await render(<FileGrid {...gridProps} blocked={new Set([100])} onToggle={onToggle} />)
		const btn = page
			.getByRole('button', { name: /Seleccionar.*photo\.jpg/ })
			.element() as HTMLButtonElement
		expect(btn.getAttribute('aria-disabled')).toBe('true')
		btn.click()
		expect(onToggle).not.toHaveBeenCalled()
	})

	it('marks video tiles with the VÍDEO badge', async () => {
		await render(<FileGrid {...gridProps} />)
		await expect.element(page.getByText('VÍDEO')).toBeVisible()
	})
})

describe('EmptyMedia', () => {
	it('shows the generic message by default', async () => {
		await render(<EmptyMedia />)
		await expect.element(page.getByText('Esta carpeta no contiene fotos ni vídeos.')).toBeVisible()
	})

	it('shows the date-specific message when the filter is active', async () => {
		await render(<EmptyMedia dateFilterActive />)
		await expect
			.element(page.getByText('No hay fotos ni vídeos de esta fecha en esta carpeta.'))
			.toBeVisible()
	})

	it('shows a custom message when provided', async () => {
		await render(<EmptyMedia emptyMessage="No hay nada hoy." />)
		await expect.element(page.getByText('No hay nada hoy.')).toBeVisible()
	})
})

describe('StickyFooter', () => {
	const footerProps = {
		count: 2,
		saving: false,
		onSave: vi.fn<() => void>(),
		onCancel: vi.fn<() => void>(),
	}

	it('shows the picked count on the Save button', async () => {
		await render(<StickyFooter {...footerProps} />)
		await expect.element(page.getByRole('button', { name: 'Guardar (2)' })).toBeVisible()
	})

	it('Save calls onSave', async () => {
		const onSave = vi.fn<() => void>()
		await render(<StickyFooter {...footerProps} onSave={onSave} />)
		await userEvent.click(page.getByRole('button', { name: /Guardar/ }))
		expect(onSave).toHaveBeenCalledTimes(1)
	})

	it('Cancel calls onCancel', async () => {
		const onCancel = vi.fn<() => void>()
		await render(<StickyFooter {...footerProps} onCancel={onCancel} />)
		await userEvent.click(page.getByRole('button', { name: 'Cancelar' }))
		expect(onCancel).toHaveBeenCalledTimes(1)
	})

	it('disables both buttons while saving', async () => {
		await render(<StickyFooter {...footerProps} saving />)
		const save = page
			.getByRole('button', { name: /Guardar|Guardando/ })
			.element() as HTMLButtonElement
		const cancel = page.getByRole('button', { name: 'Cancelar' }).element() as HTMLButtonElement
		expect(save.disabled).toBe(true)
		expect(cancel.disabled).toBe(true)
	})
})
