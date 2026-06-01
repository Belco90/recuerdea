import type { AdminFolderListing, SourceFileItem } from '#/lib/admin/source-folder.server'

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
	onToggle: vi.fn<(item: SourceFileItem) => void>(),
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

	it('file click fires onToggle with the file item', async () => {
		const onToggle = vi.fn<(item: SourceFileItem) => void>()
		await render(<AdminFolderNavigator listing={rootListing} {...baseProps} onToggle={onToggle} />)
		await userEvent.click(page.getByRole('button', { name: /Seleccionar.*photo\.jpg/ }))
		expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ fileid: 100 }))
	})

	it('blocked file is aria-disabled and does not toggle on click', async () => {
		const onToggle = vi.fn<(item: SourceFileItem) => void>()
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
})
