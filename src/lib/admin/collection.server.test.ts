import type { Client, FileMetadata } from 'pcloud-kit'

import { describe, expect, it, vi } from 'vitest'

import type { CollectionCacheStore, CollectionSnapshot } from '../cache/collection-cache'
import type { FileidIndexStore } from '../cache/fileid-index'
import type { CachedMedia, MediaCacheStore } from '../cache/media-cache'

import { createCollectionCache } from '../cache/collection-cache'
import { createFileidIndex } from '../cache/fileid-index'
import { createMediaCache } from '../cache/media-cache'
import {
	addFileidsToCollection,
	fetchCuratedItems,
	lazyMintFile,
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

function makeFileidStore() {
	const data = new Map<number, { uuid: string }>()
	const get = vi.fn<FileidIndexStore['get']>(async (fileid) => data.get(fileid))
	const set = vi.fn<FileidIndexStore['set']>(async (fileid, value) => {
		data.set(fileid, value)
	})
	const del = vi.fn<FileidIndexStore['delete']>(async (fileid) => {
		data.delete(fileid)
	})
	return { get, set, delete: del, data } satisfies FileidIndexStore & {
		data: typeof data
	}
}

function makeCached(overrides: Partial<CachedMedia> = {}): CachedMedia {
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

function makeStatFile(overrides: Partial<FileMetadata> = {}): FileMetadata {
	return {
		fileid: 100,
		parentfolderid: 0,
		name: 'a.jpg',
		isfolder: false,
		size: 0,
		contenttype: 'image/jpeg',
		hash: 'h-100',
		category: 0,
		id: 'i-100',
		isshared: false,
		icon: '',
		created: 'Mon, 15 Apr 2024 10:00:00 +0000',
		modified: '',
		...overrides,
	}
}

function fakeClient(
	handlers: Partial<{
		stat: (params: { fileid: number }) => Promise<{ metadata: FileMetadata }>
		getfilepublink: (params: { fileid: number }) => Promise<{ code: string; linkid: number }>
	}> = {},
): Client {
	return {
		call: vi.fn<Client['call']>().mockImplementation(async (method: string, params: unknown) => {
			if (method === 'stat') {
				if (!handlers.stat) throw new Error('unexpected stat call')
				return handlers.stat(params as { fileid: number })
			}
			if (method === 'getfilepublink') {
				if (!handlers.getfilepublink) throw new Error('unexpected getfilepublink call')
				return handlers.getfilepublink(params as { fileid: number })
			}
			throw new Error(`unexpected pCloud method: ${method}`)
		}) as unknown as Client['call'],
	} as unknown as Client
}

describe('fetchCuratedItems', () => {
	it('returns [] when the collection blob is empty/missing', async () => {
		const collection = createCollectionCache(makeCollectionStore())
		const media = createMediaCache(makeMediaStore())

		expect(await fetchCuratedItems(collection, media)).toEqual([])
	})

	it('maps cached uuids into CollectionItem[] (uuid + fileid)', async () => {
		const collection = createCollectionCache(
			makeCollectionStore({
				refreshedAt: '2026-05-28T00:00:00.000Z',
				uuids: ['uuid-A', 'uuid-B'],
			}),
		)
		const mediaStore = makeMediaStore()
		mediaStore.data.set('uuid-A', makeCached({ fileid: 111, code: 'CODE-A', name: 'a.jpg' }))
		mediaStore.data.set(
			'uuid-B',
			makeCached({
				fileid: 222,
				code: 'CODE-B',
				name: 'b.mp4',
				kind: 'video',
				contenttype: 'video/mp4',
			}),
		)
		const media = createMediaCache(mediaStore)

		const result = await fetchCuratedItems(collection, media)

		expect(result).toEqual([
			{
				uuid: 'uuid-A',
				fileid: 111,
				name: 'a.jpg',
				kind: 'image',
				thumbUrl: 'https://eapi.pcloud.com/getpubthumb?code=CODE-A&size=320x320',
			},
			{
				uuid: 'uuid-B',
				fileid: 222,
				name: 'b.mp4',
				kind: 'video',
				thumbUrl: 'https://eapi.pcloud.com/getpubthumb?code=CODE-B&size=320x320',
			},
		])
	})

	it('silently drops uuids whose media-cache entry is missing', async () => {
		const collection = createCollectionCache(
			makeCollectionStore({
				refreshedAt: '2026-05-28T00:00:00.000Z',
				uuids: ['uuid-A', 'uuid-GONE'],
			}),
		)
		const mediaStore = makeMediaStore()
		mediaStore.data.set('uuid-A', makeCached({ code: 'CODE-A' }))
		const media = createMediaCache(mediaStore)

		const result = await fetchCuratedItems(collection, media)

		expect(result.map((i) => i.uuid)).toEqual(['uuid-A'])
	})
})

describe('lazyMintFile', () => {
	it('returns the existing uuid without calling pCloud when fileid is already indexed', async () => {
		const fileidStore = makeFileidStore()
		fileidStore.data.set(500, { uuid: 'existing-uuid' })
		const mediaStore = makeMediaStore()
		const client = fakeClient()

		const result = await lazyMintFile(
			client,
			createFileidIndex(fileidStore),
			createMediaCache(mediaStore),
			500,
		)

		expect(result).toBe('existing-uuid')
		expect(client.call).not.toHaveBeenCalled()
		expect(mediaStore.set).not.toHaveBeenCalled()
		expect(fileidStore.set).not.toHaveBeenCalled()
	})

	it('mints a new uuid via stat + getfilepublink for an unknown fileid', async () => {
		const fileidStore = makeFileidStore()
		const mediaStore = makeMediaStore()
		const client = fakeClient({
			stat: async () => ({
				metadata: makeStatFile({
					fileid: 500,
					name: 'fresh.jpg',
					contenttype: 'image/jpeg',
					hash: 'h-fresh',
					created: 'Mon, 15 Apr 2024 10:00:00 +0000',
				}),
			}),
			getfilepublink: async () => ({ code: 'FRESH-CODE', linkid: 5050 }),
		})

		const uuid = await lazyMintFile(
			client,
			createFileidIndex(fileidStore),
			createMediaCache(mediaStore),
			500,
		)

		expect(uuid).toMatch(/^[0-9a-f-]{36}$/)
		expect(fileidStore.data.get(500)).toEqual({ uuid })
		const written = mediaStore.data.get(uuid)
		expect(written).toEqual({
			fileid: 500,
			hash: 'h-fresh',
			code: 'FRESH-CODE',
			linkid: 5050,
			kind: 'image',
			contenttype: 'image/jpeg',
			name: 'fresh.jpg',
			captureDate: new Date('Mon, 15 Apr 2024 10:00:00 +0000').toISOString(),
			width: null,
			height: null,
			location: null,
			place: null,
		})
	})

	it('derives kind=video for video contenttype', async () => {
		const fileidStore = makeFileidStore()
		const mediaStore = makeMediaStore()
		const client = fakeClient({
			stat: async () => ({
				metadata: makeStatFile({
					fileid: 700,
					name: 'clip.mp4',
					contenttype: 'video/mp4',
					hash: 'h-vid',
				}),
			}),
			getfilepublink: async () => ({ code: 'VID-CODE', linkid: 7070 }),
		})

		const uuid = await lazyMintFile(
			client,
			createFileidIndex(fileidStore),
			createMediaCache(mediaStore),
			700,
		)

		expect(mediaStore.data.get(uuid)?.kind).toBe('video')
	})

	it('leaves captureDate null when file.created is unparseable', async () => {
		const fileidStore = makeFileidStore()
		const mediaStore = makeMediaStore()
		const client = fakeClient({
			stat: async () => ({
				metadata: makeStatFile({ fileid: 800, created: 'not a date' }),
			}),
			getfilepublink: async () => ({ code: 'C', linkid: 1 }),
		})

		const uuid = await lazyMintFile(
			client,
			createFileidIndex(fileidStore),
			createMediaCache(mediaStore),
			800,
		)

		expect(mediaStore.data.get(uuid)?.captureDate).toBeNull()
	})

	it('propagates a stat error without writing any cache state', async () => {
		const fileidStore = makeFileidStore()
		const mediaStore = makeMediaStore()
		const client = fakeClient({
			stat: async () => {
				throw new Error('file not found')
			},
		})

		await expect(
			lazyMintFile(client, createFileidIndex(fileidStore), createMediaCache(mediaStore), 999),
		).rejects.toThrow('file not found')

		expect(fileidStore.set).not.toHaveBeenCalled()
		expect(mediaStore.set).not.toHaveBeenCalled()
	})
})

describe('addFileidsToCollection', () => {
	it('resolves known fileids without calling pCloud and writes uuids to the blob', async () => {
		const fileidStore = makeFileidStore()
		fileidStore.data.set(111, { uuid: 'uuid-A' })
		fileidStore.data.set(222, { uuid: 'uuid-B' })
		const mediaStore = makeMediaStore()
		const collectionStore = makeCollectionStore()
		const client = fakeClient()

		await addFileidsToCollection(
			client,
			createFileidIndex(fileidStore),
			createMediaCache(mediaStore),
			createCollectionCache(collectionStore),
			[111, 222],
		)

		expect(client.call).not.toHaveBeenCalled()
		expect(collectionStore.state.value?.uuids).toEqual(['uuid-A', 'uuid-B'])
	})

	it('lazy-mints unknown fileids and writes their fresh uuids to the blob', async () => {
		const fileidStore = makeFileidStore()
		const mediaStore = makeMediaStore()
		const collectionStore = makeCollectionStore()
		const client = fakeClient({
			stat: async (p) => ({
				metadata: makeStatFile({
					fileid: p.fileid,
					name: `f-${p.fileid}.jpg`,
					hash: `h-${p.fileid}`,
				}),
			}),
			getfilepublink: async (p) => ({ code: `code-${p.fileid}`, linkid: p.fileid * 10 }),
		})

		await addFileidsToCollection(
			client,
			createFileidIndex(fileidStore),
			createMediaCache(mediaStore),
			createCollectionCache(collectionStore),
			[333, 444],
		)

		const writtenUuids = collectionStore.state.value!.uuids
		expect(writtenUuids).toHaveLength(2)
		expect(fileidStore.data.get(333)?.uuid).toBe(writtenUuids[0])
		expect(fileidStore.data.get(444)?.uuid).toBe(writtenUuids[1])
	})

	it('dedupes against existing uuids in the collection blob', async () => {
		const fileidStore = makeFileidStore()
		fileidStore.data.set(111, { uuid: 'uuid-A' })
		fileidStore.data.set(222, { uuid: 'uuid-B' })
		const mediaStore = makeMediaStore()
		const collectionStore = makeCollectionStore({
			refreshedAt: '2026-05-28T00:00:00.000Z',
			uuids: ['uuid-A'],
		})
		const client = fakeClient()

		await addFileidsToCollection(
			client,
			createFileidIndex(fileidStore),
			createMediaCache(mediaStore),
			createCollectionCache(collectionStore),
			[111, 222],
		)

		expect(collectionStore.state.value?.uuids).toEqual(['uuid-A', 'uuid-B'])
	})

	it('updates refreshedAt on write', async () => {
		const before = Date.now()
		const fileidStore = makeFileidStore()
		fileidStore.data.set(111, { uuid: 'uuid-A' })
		const mediaStore = makeMediaStore()
		const collectionStore = makeCollectionStore({
			refreshedAt: '2020-01-01T00:00:00.000Z',
			uuids: [],
		})
		const client = fakeClient()

		await addFileidsToCollection(
			client,
			createFileidIndex(fileidStore),
			createMediaCache(mediaStore),
			createCollectionCache(collectionStore),
			[111],
		)

		const after = Date.now()
		const written = Date.parse(collectionStore.state.value!.refreshedAt)
		expect(written).toBeGreaterThanOrEqual(before)
		expect(written).toBeLessThanOrEqual(after)
	})

	it('throws TypeError on empty fileids', async () => {
		const client = fakeClient()
		await expect(
			addFileidsToCollection(
				client,
				createFileidIndex(makeFileidStore()),
				createMediaCache(makeMediaStore()),
				createCollectionCache(makeCollectionStore()),
				[],
			),
		).rejects.toThrow(TypeError)
	})

	it('throws TypeError on non-positive integers', async () => {
		const client = fakeClient()
		await expect(
			addFileidsToCollection(
				client,
				createFileidIndex(makeFileidStore()),
				createMediaCache(makeMediaStore()),
				createCollectionCache(makeCollectionStore()),
				[0],
			),
		).rejects.toThrow(TypeError)
		await expect(
			addFileidsToCollection(
				client,
				createFileidIndex(makeFileidStore()),
				createMediaCache(makeMediaStore()),
				createCollectionCache(makeCollectionStore()),
				[1.5],
			),
		).rejects.toThrow(TypeError)
	})
})

describe('removeUuidsFromCollection', () => {
	it('removes the given uuids preserving order of the rest', async () => {
		const store = makeCollectionStore({
			refreshedAt: '2026-05-28T00:00:00.000Z',
			uuids: ['uuid-A', 'uuid-B', 'uuid-C'],
		})
		const cache = createCollectionCache(store)

		await removeUuidsFromCollection(cache, ['uuid-B'])

		expect(store.state.value?.uuids).toEqual(['uuid-A', 'uuid-C'])
	})

	it('throws TypeError on empty uuids', async () => {
		const cache = createCollectionCache(makeCollectionStore())
		await expect(removeUuidsFromCollection(cache, [])).rejects.toThrow(TypeError)
	})
})
