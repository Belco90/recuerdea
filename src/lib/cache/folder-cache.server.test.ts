import type { getStore } from '@netlify/blobs'

import { describe, expect, it, vi } from 'vitest'

import type { FolderSnapshot } from './folder-cache'

vi.mock('@netlify/blobs', () => ({
	getStore: vi.fn<typeof getStore>(),
}))

describe('getFolderCacheStore', () => {
	it('returns a memoized no-op store and warns once when @netlify/blobs is unavailable', async () => {
		const blobs = await import('@netlify/blobs')
		vi.mocked(blobs.getStore).mockImplementation(() => {
			throw new Error('MissingBlobsEnvironmentError')
		})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const { getFolderCacheStore } = await import('./folder-cache.server')
		const a = getFolderCacheStore()
		const b = getFolderCacheStore()

		expect(a).toBe(b)
		expect(await a.get()).toBeUndefined()
		const snap: FolderSnapshot = { refreshedAt: '2026-04-29T04:00:00.000Z', uuids: ['a'] }
		await expect(a.set(snap)).resolves.toBeUndefined()
		expect(warn).toHaveBeenCalledTimes(1)
	})
})
