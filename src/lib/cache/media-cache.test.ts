import { describe, expect, it, vi } from 'vitest'

import type { CachedMedia, MediaCacheStore } from './media-cache'

import { createMediaCache } from './media-cache'

function makeFakeStore() {
	const data = new Map<string, CachedMedia>()
	const get = vi.fn<MediaCacheStore['get']>(async (uuid) => data.get(uuid))
	const set = vi.fn<MediaCacheStore['set']>(async (uuid, value) => {
		data.set(uuid, value)
	})
	const del = vi.fn<MediaCacheStore['delete']>(async (uuid) => {
		data.delete(uuid)
	})
	const list = vi.fn<MediaCacheStore['list']>(async () => Array.from(data.keys()))
	return { get, set, delete: del, list, data } satisfies MediaCacheStore & {
		data: typeof data
	}
}

const sampleImage: CachedMedia = {
	fileid: 100,
	hash: 'abc',
	code: 'XYZ123',
	linkid: 4242,
	kind: 'image',
	contenttype: 'image/jpeg',
	name: 'a.jpg',
	captureDate: '2019-04-28T12:00:00.000Z',
	width: 4032,
	height: 3024,
	location: { lat: 40.4168, lng: -3.7038 },
	place: 'Madrid, España',
}

const sampleVideo: CachedMedia = {
	fileid: 200,
	hash: 'def',
	code: 'ABC789',
	linkid: 9999,
	kind: 'video',
	contenttype: 'video/mp4',
	name: 'b.mp4',
	captureDate: null,
	width: null,
	height: null,
	location: null,
	place: null,
}

describe('createMediaCache', () => {
	describe('lookup', () => {
		it('returns undefined on a cold miss', async () => {
			const cache = createMediaCache(makeFakeStore())
			expect(await cache.lookup('uuid-not-there')).toBeUndefined()
		})

		it('returns the stored CachedMedia when uuid matches', async () => {
			const store = makeFakeStore()
			store.data.set('uuid-1', sampleImage)
			const cache = createMediaCache(store)

			expect(await cache.lookup('uuid-1')).toEqual(sampleImage)
		})

		it('preserves null captureDate', async () => {
			const store = makeFakeStore()
			store.data.set('uuid-2', sampleVideo)
			const cache = createMediaCache(store)

			const result = await cache.lookup('uuid-2')
			expect(result?.captureDate).toBeNull()
		})
	})

	describe('remember', () => {
		it('stores the value under the given uuid', async () => {
			const store = makeFakeStore()
			const cache = createMediaCache(store)

			await cache.remember('uuid-1', sampleImage)

			expect(store.set).toHaveBeenCalledWith('uuid-1', sampleImage)
			expect(store.data.get('uuid-1')).toEqual(sampleImage)
		})

		it('round-trips through lookup', async () => {
			const cache = createMediaCache(makeFakeStore())
			await cache.remember('uuid-1', sampleVideo)
			expect(await cache.lookup('uuid-1')).toEqual(sampleVideo)
		})
	})

	describe('forget', () => {
		it('removes the entry', async () => {
			const store = makeFakeStore()
			store.data.set('uuid-1', sampleImage)
			const cache = createMediaCache(store)

			await cache.forget('uuid-1')

			expect(store.delete).toHaveBeenCalledWith('uuid-1')
			expect(await cache.lookup('uuid-1')).toBeUndefined()
		})
	})

	describe('width and height', () => {
		it('round-trips numeric width/height alongside other fields', async () => {
			const cache = createMediaCache(makeFakeStore())
			await cache.remember('uuid-1', sampleImage)
			const result = await cache.lookup('uuid-1')
			expect(result?.width).toBe(4032)
			expect(result?.height).toBe(3024)
		})

		it('preserves null width/height (entries that pre-date the schema bump)', async () => {
			const cache = createMediaCache(makeFakeStore())
			await cache.remember('uuid-1', sampleVideo)
			const result = await cache.lookup('uuid-1')
			expect(result?.width).toBeNull()
			expect(result?.height).toBeNull()
		})
	})

	describe('listUuids', () => {
		it('returns all uuids currently stored', async () => {
			const store = makeFakeStore()
			store.data.set('a', sampleImage)
			store.data.set('b', sampleVideo)
			const cache = createMediaCache(store)

			const uuids = await cache.listUuids()
			expect(new Set(uuids)).toEqual(new Set(['a', 'b']))
		})

		it('returns an empty array when the store is empty', async () => {
			const cache = createMediaCache(makeFakeStore())
			expect(await cache.listUuids()).toEqual([])
		})
	})
})
