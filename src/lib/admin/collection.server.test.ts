import { describe, expect, it, vi } from 'vitest'

import type { CollectionCacheStore, CollectionSnapshot } from '../cache/collection-cache'
import type { CachedMedia, MediaCacheStore } from '../cache/media-cache'

import { createCollectionCache } from '../cache/collection-cache'
import { createMediaCache } from '../cache/media-cache'
import {
	addUuidsToCollection,
	fetchCuratedItems,
	removeUuidsFromCollection,
} from './collection.server'

function makeCollectionStore(initial?: CollectionSnapshot) {
	const state: { value: CollectionSnapshot | undefined } = { value: initial }
	const get = vi.fn<CollectionCacheStore['get']>(async () => state.value)
	const set = vi.fn<CollectionCacheStore['set']>(async (next) => {
		state.value = next
	})
	return { get, set, state } satisfies CollectionCacheStore & { state: typeof state }
}

function makeMediaStore() {
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

function makeCachedImage(overrides: Partial<CachedMedia> = {}): CachedMedia {
	return {
		fileid: 100,
		hash: 'abc',
		code: 'CODE-IMG',
		linkid: 1,
		kind: 'image',
		contenttype: 'image/jpeg',
		name: 'a.jpg',
		captureDate: null,
		width: null,
		height: null,
		location: null,
		place: null,
		...overrides,
	}
}

function makeCachedVideo(overrides: Partial<CachedMedia> = {}): CachedMedia {
	return makeCachedImage({
		kind: 'video',
		contenttype: 'video/mp4',
		name: 'b.mp4',
		code: 'CODE-VID',
		...overrides,
	})
}

describe('fetchCuratedItems', () => {
	it('returns [] when the collection blob is empty/missing', async () => {
		const collection = createCollectionCache(makeCollectionStore())
		const media = createMediaCache(makeMediaStore())

		expect(await fetchCuratedItems(collection, media)).toEqual([])
	})

	it('returns [] when the snapshot has an empty uuid list', async () => {
		const collection = createCollectionCache(
			makeCollectionStore({ refreshedAt: '2026-05-27T00:00:00.000Z', uuids: [] }),
		)
		const media = createMediaCache(makeMediaStore())

		expect(await fetchCuratedItems(collection, media)).toEqual([])
	})

	it('maps cached uuids into AdminFileItem[] preserving snapshot order', async () => {
		const collection = createCollectionCache(
			makeCollectionStore({
				refreshedAt: '2026-05-27T00:00:00.000Z',
				uuids: ['uuid-A', 'uuid-B'],
			}),
		)
		const mediaStore = makeMediaStore()
		mediaStore.data.set('uuid-A', makeCachedImage({ code: 'CODE-A', name: 'a.jpg' }))
		mediaStore.data.set('uuid-B', makeCachedVideo({ code: 'CODE-B', name: 'b.mp4' }))
		const media = createMediaCache(mediaStore)

		const result = await fetchCuratedItems(collection, media)

		expect(result).toEqual([
			{
				uuid: 'uuid-A',
				name: 'a.jpg',
				kind: 'image',
				thumbUrl: 'https://eapi.pcloud.com/getpubthumb?code=CODE-A&size=320x320',
			},
			{
				uuid: 'uuid-B',
				name: 'b.mp4',
				kind: 'video',
				thumbUrl: 'https://eapi.pcloud.com/getpubthumb?code=CODE-B&size=320x320',
			},
		])
	})

	it('silently drops uuids whose media-cache entry is missing', async () => {
		const collection = createCollectionCache(
			makeCollectionStore({
				refreshedAt: '2026-05-27T00:00:00.000Z',
				uuids: ['uuid-A', 'uuid-MISSING', 'uuid-B'],
			}),
		)
		const mediaStore = makeMediaStore()
		mediaStore.data.set('uuid-A', makeCachedImage({ code: 'CODE-A', name: 'a.jpg' }))
		mediaStore.data.set('uuid-B', makeCachedImage({ code: 'CODE-B', name: 'b.jpg' }))
		const media = createMediaCache(mediaStore)

		const result = await fetchCuratedItems(collection, media)

		expect(result.map((i) => i.uuid)).toEqual(['uuid-A', 'uuid-B'])
	})
})

describe('addUuidsToCollection', () => {
	it('initialises the snapshot when none exists', async () => {
		const store = makeCollectionStore()
		const cache = createCollectionCache(store)

		await addUuidsToCollection(cache, ['uuid-A'])

		expect(store.state.value?.uuids).toEqual(['uuid-A'])
		expect(store.state.value?.refreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
	})

	it('appends new uuids preserving insertion order', async () => {
		const store = makeCollectionStore({
			refreshedAt: '2026-05-27T00:00:00.000Z',
			uuids: ['uuid-A'],
		})
		const cache = createCollectionCache(store)

		await addUuidsToCollection(cache, ['uuid-B', 'uuid-C'])

		expect(store.state.value?.uuids).toEqual(['uuid-A', 'uuid-B', 'uuid-C'])
	})

	it('dedupes uuids already present in the snapshot', async () => {
		const store = makeCollectionStore({
			refreshedAt: '2026-05-27T00:00:00.000Z',
			uuids: ['uuid-A', 'uuid-B'],
		})
		const cache = createCollectionCache(store)

		await addUuidsToCollection(cache, ['uuid-B', 'uuid-C', 'uuid-A'])

		expect(store.state.value?.uuids).toEqual(['uuid-A', 'uuid-B', 'uuid-C'])
	})

	it('updates refreshedAt to the current time on write', async () => {
		const before = Date.now()
		const store = makeCollectionStore({
			refreshedAt: '2020-01-01T00:00:00.000Z',
			uuids: [],
		})
		const cache = createCollectionCache(store)

		await addUuidsToCollection(cache, ['uuid-A'])

		const after = Date.now()
		const written = Date.parse(store.state.value!.refreshedAt)
		expect(written).toBeGreaterThanOrEqual(before)
		expect(written).toBeLessThanOrEqual(after)
	})

	it('throws TypeError on empty uuids array', async () => {
		const cache = createCollectionCache(makeCollectionStore())
		await expect(addUuidsToCollection(cache, [])).rejects.toThrow(TypeError)
	})

	it('throws TypeError when any uuid is not a non-empty string', async () => {
		const cache = createCollectionCache(makeCollectionStore())
		await expect(addUuidsToCollection(cache, [''])).rejects.toThrow(TypeError)
		await expect(addUuidsToCollection(cache, [123 as unknown as string])).rejects.toThrow(TypeError)
	})
})

describe('removeUuidsFromCollection', () => {
	it('removes the given uuids preserving order of the rest', async () => {
		const store = makeCollectionStore({
			refreshedAt: '2026-05-27T00:00:00.000Z',
			uuids: ['uuid-A', 'uuid-B', 'uuid-C', 'uuid-D'],
		})
		const cache = createCollectionCache(store)

		await removeUuidsFromCollection(cache, ['uuid-B', 'uuid-D'])

		expect(store.state.value?.uuids).toEqual(['uuid-A', 'uuid-C'])
	})

	it('no-ops on an empty snapshot (writes empty snapshot)', async () => {
		const store = makeCollectionStore()
		const cache = createCollectionCache(store)

		await removeUuidsFromCollection(cache, ['uuid-X'])

		expect(store.state.value?.uuids).toEqual([])
	})

	it('ignores uuids that are not present in the snapshot', async () => {
		const store = makeCollectionStore({
			refreshedAt: '2026-05-27T00:00:00.000Z',
			uuids: ['uuid-A'],
		})
		const cache = createCollectionCache(store)

		await removeUuidsFromCollection(cache, ['uuid-NOTHING'])

		expect(store.state.value?.uuids).toEqual(['uuid-A'])
	})

	it('throws TypeError on empty uuids array', async () => {
		const cache = createCollectionCache(makeCollectionStore())
		await expect(removeUuidsFromCollection(cache, [])).rejects.toThrow(TypeError)
	})

	it('throws TypeError when any uuid is not a non-empty string', async () => {
		const cache = createCollectionCache(makeCollectionStore())
		await expect(removeUuidsFromCollection(cache, [''])).rejects.toThrow(TypeError)
	})
})
