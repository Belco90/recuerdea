import type { getStore } from '@netlify/blobs'

import { describe, expect, it, vi } from 'vitest'

import type { CollectionSnapshot } from './collection-cache'

vi.mock('@netlify/blobs', () => ({
	getStore: vi.fn<typeof getStore>(),
}))

describe('getCollectionCacheStore', () => {
	it('returns a memoized no-op store and warns once when @netlify/blobs is unavailable', async () => {
		const blobs = await import('@netlify/blobs')
		vi.mocked(blobs.getStore).mockImplementation(() => {
			throw new Error('MissingBlobsEnvironmentError')
		})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const { getCollectionCacheStore } = await import('./collection-cache.server')
		const a = getCollectionCacheStore()
		const b = getCollectionCacheStore()

		expect(a).toBe(b)
		expect(await a.get()).toBeUndefined()
		const snap: CollectionSnapshot = { refreshedAt: '2026-04-29T04:00:00.000Z', uuids: ['a'] }
		await expect(a.set(snap)).resolves.toBeUndefined()
		expect(warn).toHaveBeenCalledTimes(1)
	})
})
