import { describe, expect, it, vi } from 'vitest'

import type { CaptureCacheStore, CaptureCacheValue } from './capture-cache'

import { createCaptureCache } from './capture-cache'

function makeFakeStore() {
	const data = new Map<number, CaptureCacheValue>()
	const get = vi.fn<CaptureCacheStore['get']>(async (fileid) => data.get(fileid))
	const set = vi.fn<CaptureCacheStore['set']>(async (fileid, value) => {
		data.set(fileid, value)
	})
	return { get, set, data } satisfies CaptureCacheStore & { data: typeof data }
}

describe('createCaptureCache', () => {
	describe('lookup', () => {
		it('returns undefined on a cold miss', async () => {
			const cache = createCaptureCache(makeFakeStore())
			expect(await cache.lookup(123, 'abc')).toBeUndefined()
		})

		it('returns the stored Date when fileid + hash match', async () => {
			const store = makeFakeStore()
			store.data.set(123, { hash: 'abc', captureDate: '2019-04-28T12:00:00.000Z' })
			const cache = createCaptureCache(store)

			const result = await cache.lookup(123, 'abc')

			expect(result).toBeInstanceOf(Date)
			expect((result as Date).toISOString()).toBe('2019-04-28T12:00:00.000Z')
		})

		it('returns null (not undefined) for a cached negative result', async () => {
			const store = makeFakeStore()
			store.data.set(123, { hash: 'abc', captureDate: null })
			const cache = createCaptureCache(store)

			expect(await cache.lookup(123, 'abc')).toBeNull()
		})

		it('returns undefined when the fileid matches but the hash does not', async () => {
			const store = makeFakeStore()
			store.data.set(123, { hash: 'old-hash', captureDate: '2019-04-28T12:00:00.000Z' })
			const cache = createCaptureCache(store)

			expect(await cache.lookup(123, 'new-hash')).toBeUndefined()
		})
	})

	describe('remember', () => {
		it('stores the ISO string of a Date with the given hash', async () => {
			const store = makeFakeStore()
			const cache = createCaptureCache(store)

			await cache.remember(123, 'abc', new Date('2019-04-28T12:00:00.000Z'))

			expect(store.set).toHaveBeenCalledWith(123, {
				hash: 'abc',
				captureDate: '2019-04-28T12:00:00.000Z',
			})
		})

		it('stores an explicit null for negative results', async () => {
			const store = makeFakeStore()
			const cache = createCaptureCache(store)

			await cache.remember(123, 'abc', null)

			expect(store.set).toHaveBeenCalledWith(123, { hash: 'abc', captureDate: null })
		})

		it('round-trips through lookup after remember', async () => {
			const cache = createCaptureCache(makeFakeStore())
			const captured = new Date('2020-01-15T08:30:00.000Z')

			await cache.remember(456, 'hash-xyz', captured)
			const result = await cache.lookup(456, 'hash-xyz')

			expect(result).toBeInstanceOf(Date)
			expect((result as Date).toISOString()).toBe(captured.toISOString())
		})
	})
})
