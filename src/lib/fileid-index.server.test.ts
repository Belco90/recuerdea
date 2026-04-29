import type { getStore } from '@netlify/blobs'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@netlify/blobs', () => ({
	getStore: vi.fn<typeof getStore>(),
}))

describe('getFileidIndexStore', () => {
	it('returns a memoized no-op store and warns once when @netlify/blobs is unavailable', async () => {
		const blobs = await import('@netlify/blobs')
		vi.mocked(blobs.getStore).mockImplementation(() => {
			throw new Error('MissingBlobsEnvironmentError')
		})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const { getFileidIndexStore } = await import('./fileid-index.server')
		const a = getFileidIndexStore()
		const b = getFileidIndexStore()

		expect(a).toBe(b)
		expect(await a.get(123)).toBeUndefined()
		await expect(a.set(123, { uuid: 'u' })).resolves.toBeUndefined()
		await expect(a.delete(123)).resolves.toBeUndefined()
		expect(warn).toHaveBeenCalledTimes(1)
	})
})
