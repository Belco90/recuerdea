import type { AdminFolderListing } from '#/lib/admin/source-folder.server'

import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { AdminFolderNavigator } from './AdminFolderNavigator'

const rootListing: AdminFolderListing = {
	folderid: 1000,
	name: 'Raíz',
	breadcrumbs: [{ folderid: 1000, name: 'Raíz' }],
	subfolders: [
		{ folderid: 11, name: 'Sub A' },
		{ folderid: 12, name: 'Sub B' },
	],
	files: [
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
	],
}

const deepListing: AdminFolderListing = {
	folderid: 33,
	name: 'Viaje',
	breadcrumbs: [
		{ folderid: 1000, name: 'Raíz' },
		{ folderid: 11, name: 'Año 2024' },
		{ folderid: 22, name: 'Mayo' },
		{ folderid: 33, name: 'Viaje' },
	],
	subfolders: [],
	files: [
		{
			fileid: 100,
			name: 'photo.jpg',
			kind: 'image',
			thumbUrl: 'https://example.test/thumb-100.jpg',
			created: '2024-04-15T10:00:00.000Z',
		},
	],
}

const emptyListing: AdminFolderListing = {
	folderid: 1000,
	name: 'Raíz',
	breadcrumbs: [{ folderid: 1000, name: 'Raíz' }],
	subfolders: [{ folderid: 11, name: 'Sub A' }],
	files: [],
}

const baseProps = {
	picked: new Set<number>(),
	blocked: new Set<number>(),
	onNavigate: vi.fn<(folderid: number) => void>(),
	onToggle: vi.fn<(fileid: number) => void>(),
	onSave: vi.fn<(fileids: readonly number[]) => void>(),
	onCancel: vi.fn<() => void>(),
}

describe('AdminFolderNavigator', () => {
	it('renders one breadcrumb per crumb', async () => {
		await render(<AdminFolderNavigator listing={deepListing} {...baseProps} />)
		await expect.element(page.getByRole('button', { name: 'Raíz' })).toBeVisible()
		await expect.element(page.getByRole('button', { name: 'Año 2024' })).toBeVisible()
		await expect.element(page.getByRole('button', { name: 'Mayo' })).toBeVisible()
	})

	it('breadcrumb click fires onNavigate with the crumb folderid', async () => {
		const onNavigate = vi.fn<(folderid: number) => void>()
		await render(
			<AdminFolderNavigator listing={deepListing} {...baseProps} onNavigate={onNavigate} />,
		)
		await userEvent.click(page.getByRole('button', { name: 'Raíz' }))
		expect(onNavigate).toHaveBeenCalledWith(1000)
	})

	it('subfolder click fires onNavigate with the subfolder folderid', async () => {
		const onNavigate = vi.fn<(folderid: number) => void>()
		await render(
			<AdminFolderNavigator listing={rootListing} {...baseProps} onNavigate={onNavigate} />,
		)
		await userEvent.click(page.getByRole('button', { name: /Sub A/ }))
		expect(onNavigate).toHaveBeenCalledWith(11)
	})

	it('file click fires onToggle with the fileid', async () => {
		const onToggle = vi.fn<(fileid: number) => void>()
		await render(<AdminFolderNavigator listing={rootListing} {...baseProps} onToggle={onToggle} />)
		await userEvent.click(page.getByRole('button', { name: /Seleccionar.*photo\.jpg/ }))
		expect(onToggle).toHaveBeenCalledWith(100)
	})

	it('hides the footer when no file is picked', async () => {
		await render(<AdminFolderNavigator listing={rootListing} {...baseProps} />)
		expect(page.getByRole('button', { name: /Guardar/ }).query()).toBeNull()
	})

	it('shows the footer with the picked count', async () => {
		await render(
			<AdminFolderNavigator listing={rootListing} {...baseProps} picked={new Set([100, 200])} />,
		)
		await expect.element(page.getByRole('button', { name: 'Guardar (2)' })).toBeVisible()
	})

	it('Save calls onSave with the picked fileids', async () => {
		const onSave = vi.fn<(fileids: readonly number[]) => void>()
		await render(
			<AdminFolderNavigator
				listing={rootListing}
				{...baseProps}
				picked={new Set([100])}
				onSave={onSave}
			/>,
		)
		await userEvent.click(page.getByRole('button', { name: /Guardar/ }))
		expect(onSave).toHaveBeenCalledTimes(1)
		expect(onSave.mock.calls[0]?.[0]).toEqual([100])
	})

	it('Cancel calls onCancel', async () => {
		const onCancel = vi.fn<() => void>()
		await render(
			<AdminFolderNavigator
				listing={rootListing}
				{...baseProps}
				picked={new Set([100])}
				onCancel={onCancel}
			/>,
		)
		await userEvent.click(page.getByRole('button', { name: 'Cancelar' }))
		expect(onCancel).toHaveBeenCalledTimes(1)
	})

	it('blocked file is aria-disabled and does not toggle on click', async () => {
		const onToggle = vi.fn<(fileid: number) => void>()
		await render(
			<AdminFolderNavigator
				listing={rootListing}
				{...baseProps}
				blocked={new Set([100])}
				onToggle={onToggle}
			/>,
		)
		const btn = page
			.getByRole('button', { name: /Seleccionar.*photo\.jpg/ })
			.element() as HTMLButtonElement
		expect(btn.getAttribute('aria-disabled')).toBe('true')
		btn.click()
		expect(onToggle).not.toHaveBeenCalled()
	})

	it('marks video tiles with the VÍDEO badge', async () => {
		await render(<AdminFolderNavigator listing={rootListing} {...baseProps} />)
		await expect.element(page.getByText('VÍDEO')).toBeVisible()
	})

	it('shows the date-specific empty message when the filter hides all media', async () => {
		await render(<AdminFolderNavigator listing={emptyListing} {...baseProps} dateFilterActive />)
		await expect
			.element(page.getByText('No hay fotos ni vídeos de esta fecha en esta carpeta.'))
			.toBeVisible()
	})

	it('shows the generic empty message when no filter is active', async () => {
		await render(<AdminFolderNavigator listing={emptyListing} {...baseProps} />)
		await expect.element(page.getByText('Esta carpeta no contiene fotos ni vídeos.')).toBeVisible()
	})

	it('disables Save while saving', async () => {
		await render(
			<AdminFolderNavigator listing={rootListing} {...baseProps} picked={new Set([100])} saving />,
		)
		const btn = page
			.getByRole('button', { name: /Guardar|Guardando/ })
			.element() as HTMLButtonElement
		expect(btn.disabled).toBe(true)
	})
})
