import type { MemoryItem } from '#/lib/memories/pcloud.server'

import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { render } from '../../test/test-utils'
import { Polaroid } from './Polaroid'

const imageItem: MemoryItem = {
	kind: 'image',
	uuid: 'img-1',
	name: 'beach.jpg',
	captureDate: '2024-07-15T10:00:00.000Z',
	width: 800,
	height: 600,
	place: 'A Coruña',
	thumbUrl: 'https://example.test/thumb.jpg',
	lightboxUrl: 'https://example.test/lightbox.jpg',
}

const videoItem: MemoryItem = {
	kind: 'video',
	uuid: 'vid-1',
	contenttype: 'video/mp4',
	name: 'clip.mp4',
	captureDate: '2024-07-15T10:00:00.000Z',
	width: 1920,
	height: 1080,
	place: null,
	thumbUrl: 'https://example.test/thumb.jpg',
	lightboxUrl: 'https://example.test/lightbox.jpg',
	mediaUrl: 'https://example.test/clip.mp4',
}

describe('Polaroid', () => {
	it('renders the place caption for image items', async () => {
		await render(<Polaroid item={imageItem} keyId="2024-0" onClick={vi.fn<() => void>()} />)
		await expect.element(page.getByText('A Coruña')).toBeVisible()
	})

	it('marks video items with the VÍDEO badge', async () => {
		await render(<Polaroid item={videoItem} keyId="2024-1" onClick={vi.fn<() => void>()} />)
		await expect.element(page.getByText('VÍDEO')).toBeVisible()
	})

	it('calls onClick when the polaroid is activated', async () => {
		const onClick = vi.fn<() => void>()
		await render(<Polaroid item={imageItem} keyId="2024-0" onClick={onClick} />)
		await userEvent.click(page.getByRole('button', { name: 'A Coruña' }))
		expect(onClick).toHaveBeenCalledOnce()
	})
})
