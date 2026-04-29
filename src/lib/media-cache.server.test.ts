import type { getStore } from '@netlify/blobs'

import { describe, expect, it, vi } from 'vitest'

import type { CachedMedia } from './media-cache'

vi.mock('@netlify/blobs', () => ({
	getStore: vi.fn<typeof getStore>(),
}))

const sample: CachedMedia = {
	fileid: 100,
	hash: 'abc',
	code: 'XYZ123',
	linkid: 4242,
	kind: 'image',
	contenttype: 'image/jpeg',
	name: 'a.jpg',
	captureDate: '2019-04-28T12:00:00.000Z',
}

describe('getMediaCacheStore', () => {
	it('returns a memoized no-op store and warns once when @netlify/blobs is unavailable', async () => {
		const blobs = await import('@netlify/blobs')
		vi.mocked(blobs.getStore).mockImplementation(() => {
			throw new Error('MissingBlobsEnvironmentError')
		})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const { getMediaCacheStore } = await import('./media-cache.server')
		const a = getMediaCacheStore()
		const b = getMediaCacheStore()

		expect(a).toBe(b)
		expect(await a.get('uuid-1')).toBeUndefined()
		await expect(a.set('uuid-1', sample)).resolves.toBeUndefined()
		await expect(a.delete('uuid-1')).resolves.toBeUndefined()
		expect(await a.list()).toEqual([])
		expect(warn).toHaveBeenCalledTimes(1)
	})
})
