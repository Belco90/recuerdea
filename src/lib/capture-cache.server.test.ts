import type { getStore } from '@netlify/blobs'

import { describe, expect, it, vi } from 'vitest'

import type { CaptureCacheValue } from './capture-cache'

vi.mock('@netlify/blobs', () => ({
	getStore: vi.fn<typeof getStore>(),
}))

describe('getCaptureCacheStore', () => {
	it('returns a memoized no-op store and warns once when @netlify/blobs is unavailable', async () => {
		const blobs = await import('@netlify/blobs')
		vi.mocked(blobs.getStore).mockImplementation(() => {
			throw new Error('MissingBlobsEnvironmentError')
		})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const { getCaptureCacheStore } = await import('./capture-cache.server')
		const a = getCaptureCacheStore()
		const b = getCaptureCacheStore()

		expect(a).toBe(b)
		expect(await a.get(123)).toBeUndefined()
		const value: CaptureCacheValue = { hash: 'abc', captureDate: null }
		await expect(a.set(123, value)).resolves.toBeUndefined()
		expect(warn).toHaveBeenCalledTimes(1)
	})
})
