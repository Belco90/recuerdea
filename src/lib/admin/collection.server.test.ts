import type { Client, FileMetadata } from 'pcloud-kit'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileidIndexStore } from '../cache/fileid-index'
import type { CachedMedia, MediaCacheStore } from '../cache/media-cache'

import { createFileidIndex } from '../cache/fileid-index'
import { createMediaCache } from '../cache/media-cache'
import {
	CollectionIdMissingError,
	assertCollectionId,
	fetchCollectionMedia,
	linkFilesToCollectionRaw,
	unlinkFilesFromCollectionRaw,
} from './collection.server'

function makeMediaStore(entries: Record<string, CachedMedia> = {}) {
	const data = new Map(Object.entries(entries))
	return {
		get: vi.fn<MediaCacheStore['get']>(async (uuid) => data.get(uuid)),
		set: vi.fn<MediaCacheStore['set']>(async (uuid, value) => {
			data.set(uuid, value)
		}),
		delete: vi.fn<MediaCacheStore['delete']>(async (uuid) => {
			data.delete(uuid)
		}),
		list: vi.fn<MediaCacheStore['list']>(async () => Array.from(data.keys())),
		data,
	}
}

function makeFileidStore(entries: Record<number, string> = {}) {
	const data = new Map<number, { uuid: string }>()
	for (const [k, v] of Object.entries(entries)) data.set(Number(k), { uuid: v })
	return {
		get: vi.fn<FileidIndexStore['get']>(async (fileid) => data.get(fileid)),
		set: vi.fn<FileidIndexStore['set']>(async (fileid, value) => {
			data.set(fileid, value)
		}),
		delete: vi.fn<FileidIndexStore['delete']>(async (fileid) => {
			data.delete(fileid)
		}),
		data,
	}
}

function makeClient(impl: (method: string, params: unknown) => Promise<unknown>): Client {
	return {
		call: vi.fn<(method: string, params: unknown) => Promise<unknown>>(
			impl,
		) as unknown as Client['call'],
	} as unknown as Client
}

function makeFile(fileid: number, name = `f-${fileid}.jpg`): FileMetadata {
	return {
		fileid,
		parentfolderid: 0,
		name,
		isfolder: false,
		size: 0,
		contenttype: 'image/jpeg',
		hash: `h-${fileid}`,
		category: 0,
		id: '',
		isshared: false,
		icon: '',
		created: '',
		modified: '',
	}
}

const imageA: CachedMedia = {
	fileid: 100,
	hash: 'h-100',
	code: 'CODE-A',
	linkid: 1000,
	kind: 'image',
	contenttype: 'image/jpeg',
	name: 'a.jpg',
	captureDate: '2024-04-27T14:30:00.000Z',
	width: 4032,
	height: 3024,
	location: null,
	place: null,
}

const imageB: CachedMedia = {
	fileid: 200,
	hash: 'h-200',
	code: 'CODE-B',
	linkid: 2000,
	kind: 'image',
	contenttype: 'image/jpeg',
	name: 'b.jpg',
	captureDate: '2024-06-15T09:00:00.000Z',
	width: null,
	height: null,
	location: null,
	place: null,
}

const thumb320 = (code: string) =>
	`https://eapi.pcloud.com/getpubthumb?code=${encodeURIComponent(code)}&size=320x320`

beforeEach(() => {
	vi.stubEnv('PCLOUD_COLLECTION_ID', '99')
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.clearAllMocks()
})

describe('assertCollectionId', () => {
	it('returns the parsed integer when env var is set', () => {
		vi.stubEnv('PCLOUD_COLLECTION_ID', '42')
		expect(assertCollectionId()).toBe(42)
	})

	it('throws CollectionIdMissingError when env var is unset', () => {
		vi.stubEnv('PCLOUD_COLLECTION_ID', '')
		expect(() => assertCollectionId()).toThrow(CollectionIdMissingError)
	})

	it('throws TypeError when env var is not an integer', () => {
		vi.stubEnv('PCLOUD_COLLECTION_ID', 'abc')
		expect(() => assertCollectionId()).toThrow(TypeError)
	})
})

describe('fetchCollectionMedia', () => {
	it('maps collection fileids → uuids → cached media into AdminMediaItem[]', async () => {
		const client = makeClient(async (method, params) => {
			expect(method).toBe('collection_details')
			expect(params).toEqual({ collectionid: 99, showfiles: 1 })
			return { collection: { items: 2, contents: [makeFile(100), makeFile(200)] } }
		})
		const fileidIndex = createFileidIndex(makeFileidStore({ 100: 'uuid-a', 200: 'uuid-b' }))
		const mediaCache = createMediaCache(makeMediaStore({ 'uuid-a': imageA, 'uuid-b': imageB }))

		const result = await fetchCollectionMedia(client, fileidIndex, mediaCache)

		expect(result).toEqual([
			{
				uuid: 'uuid-a',
				kind: 'image',
				name: 'a.jpg',
				captureDate: '2024-04-27T14:30:00.000Z',
				fileid: 100,
				thumbUrl: thumb320('CODE-A'),
			},
			{
				uuid: 'uuid-b',
				kind: 'image',
				name: 'b.jpg',
				captureDate: '2024-06-15T09:00:00.000Z',
				fileid: 200,
				thumbUrl: thumb320('CODE-B'),
			},
		])
	})

	it('skips fileids that have no entry in the fileid-index', async () => {
		const client = makeClient(async () => ({
			collection: { items: 2, contents: [makeFile(100), makeFile(999)] },
		}))
		const fileidIndex = createFileidIndex(makeFileidStore({ 100: 'uuid-a' }))
		const mediaCache = createMediaCache(makeMediaStore({ 'uuid-a': imageA }))

		const result = await fetchCollectionMedia(client, fileidIndex, mediaCache)

		expect(result.map((m) => m.uuid)).toEqual(['uuid-a'])
	})

	it('skips uuids that have no entry in the media cache', async () => {
		const client = makeClient(async () => ({
			collection: { items: 2, contents: [makeFile(100), makeFile(200)] },
		}))
		const fileidIndex = createFileidIndex(makeFileidStore({ 100: 'uuid-a', 200: 'uuid-ghost' }))
		const mediaCache = createMediaCache(makeMediaStore({ 'uuid-a': imageA }))

		const result = await fetchCollectionMedia(client, fileidIndex, mediaCache)

		expect(result.map((m) => m.uuid)).toEqual(['uuid-a'])
	})

	it('returns [] when the collection has no items', async () => {
		const client = makeClient(async () => ({ collection: {} }))
		const fileidIndex = createFileidIndex(makeFileidStore())
		const mediaCache = createMediaCache(makeMediaStore())

		expect(await fetchCollectionMedia(client, fileidIndex, mediaCache)).toEqual([])
	})

	it('returns [] for the real empty-collection shape (`items: 0`, no `contents`)', async () => {
		// Regression for "items is not iterable": pCloud returns `items` as the
		// numeric count, not the file array, and omits `contents` entirely when
		// the collection has zero files.
		const client = makeClient(async () => ({ collection: { items: 0 } }))
		const fileidIndex = createFileidIndex(makeFileidStore())
		const mediaCache = createMediaCache(makeMediaStore())

		expect(await fetchCollectionMedia(client, fileidIndex, mediaCache)).toEqual([])
	})

	it('throws CollectionIdMissingError when PCLOUD_COLLECTION_ID is unset', async () => {
		vi.stubEnv('PCLOUD_COLLECTION_ID', '')
		const client = makeClient(async () => ({ collection: { items: 0 } }))
		const fileidIndex = createFileidIndex(makeFileidStore())
		const mediaCache = createMediaCache(makeMediaStore())

		await expect(fetchCollectionMedia(client, fileidIndex, mediaCache)).rejects.toThrow(
			CollectionIdMissingError,
		)
	})
})

describe('linkFilesToCollectionRaw', () => {
	it('resolves uuids → fileids and calls collection_linkfiles with a CSV', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const client = makeClient(async (method, params) => {
			calls.push({ method, params })
			return { result: 0 }
		})
		const mediaCache = createMediaCache(makeMediaStore({ 'uuid-a': imageA, 'uuid-b': imageB }))

		await linkFilesToCollectionRaw(client, mediaCache, ['uuid-a', 'uuid-b'])

		expect(calls).toEqual([
			{
				method: 'collection_linkfiles',
				params: { collectionid: 99, fileids: '100,200' },
			},
		])
	})

	it('throws TypeError when uuids is empty', async () => {
		const client = makeClient(async () => ({ result: 0 }))
		const mediaCache = createMediaCache(makeMediaStore())

		await expect(linkFilesToCollectionRaw(client, mediaCache, [])).rejects.toThrow(TypeError)
	})

	it('throws when a uuid has no entry in the media cache', async () => {
		const client = makeClient(async () => ({ result: 0 }))
		const mediaCache = createMediaCache(makeMediaStore({ 'uuid-a': imageA }))

		await expect(
			linkFilesToCollectionRaw(client, mediaCache, ['uuid-a', 'uuid-ghost']),
		).rejects.toThrow(/uuid-ghost/)
	})

	it('throws CollectionIdMissingError when env var is unset', async () => {
		vi.stubEnv('PCLOUD_COLLECTION_ID', '')
		const client = makeClient(async () => ({ result: 0 }))
		const mediaCache = createMediaCache(makeMediaStore({ 'uuid-a': imageA }))

		await expect(linkFilesToCollectionRaw(client, mediaCache, ['uuid-a'])).rejects.toThrow(
			CollectionIdMissingError,
		)
	})
})

describe('unlinkFilesFromCollectionRaw', () => {
	it('calls collection_unlinkfiles with a CSV of fileids', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const client = makeClient(async (method, params) => {
			calls.push({ method, params })
			return { result: 0 }
		})
		const mediaCache = createMediaCache(makeMediaStore({ 'uuid-a': imageA }))

		await unlinkFilesFromCollectionRaw(client, mediaCache, ['uuid-a'])

		expect(calls).toEqual([
			{
				method: 'collection_unlinkfiles',
				params: { collectionid: 99, fileids: '100' },
			},
		])
	})

	it('throws TypeError when uuids is empty', async () => {
		const client = makeClient(async () => ({ result: 0 }))
		const mediaCache = createMediaCache(makeMediaStore())

		await expect(unlinkFilesFromCollectionRaw(client, mediaCache, [])).rejects.toThrow(TypeError)
	})
})
