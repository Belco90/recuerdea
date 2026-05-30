import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CollectionCacheStore, CollectionSnapshot } from '../cache/collection-cache'
import type { CachedMedia, MediaCacheStore } from '../cache/media-cache'

import { getCollectionCacheStore } from '../cache/collection-cache.server'
import { getMediaCacheStore } from '../cache/media-cache.server'
import { fetchTodayMemories } from './pcloud.server'

vi.mock('../cache/media-cache.server')
vi.mock('../cache/collection-cache.server')

const mockedGetMediaCacheStore = vi.mocked(getMediaCacheStore)
const mockedGetCollectionCacheStore = vi.mocked(getCollectionCacheStore)

function makeCollectionStore(snapshot: CollectionSnapshot | undefined = undefined) {
	const state: { value: CollectionSnapshot | undefined } = { value: snapshot }
	return {
		get: vi.fn<CollectionCacheStore['get']>(async () => state.value),
		set: vi.fn<CollectionCacheStore['set']>(async (next) => {
			state.value = next
		}),
		state,
	}
}

const thumb640 = (code: string) =>
	`https://eapi.pcloud.com/getpubthumb?code=${encodeURIComponent(code)}&size=640x640`
const thumb1025 = (code: string) =>
	`https://eapi.pcloud.com/getpubthumb?code=${encodeURIComponent(code)}&size=1025x1025`

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

const imageA: CachedMedia = {
	fileid: 100,
	hash: 'h-a',
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
	hash: 'h-b',
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

const videoC: CachedMedia = {
	fileid: 300,
	hash: 'h-c',
	code: 'CODE-C',
	linkid: 3000,
	kind: 'video',
	contenttype: 'video/mp4',
	name: 'c.mp4',
	captureDate: '2018-04-27T10:00:00.000Z',
	width: 1920,
	height: 1080,
	location: null,
	place: null,
}

const undatedD: CachedMedia = {
	fileid: 400,
	hash: 'h-d',
	code: 'CODE-D',
	linkid: 4000,
	kind: 'image',
	contenttype: 'image/heic',
	name: 'IMG_4567.HEIC',
	captureDate: null,
	width: null,
	height: null,
	location: null,
	place: null,
}

function snap(uuids: readonly string[]): CollectionSnapshot {
	return { refreshedAt: '2026-04-29T04:00:00.000Z', uuids }
}

beforeEach(() => {
	mockedGetMediaCacheStore.mockReset()
	mockedGetCollectionCacheStore.mockReset()
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('fetchTodayMemories', () => {
	it('returns [] and warns when the collection blob is missing', async () => {
		mockedGetCollectionCacheStore.mockReturnValue(makeCollectionStore(undefined))
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore())
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const result = await fetchTodayMemories({ month: 4, day: 27 })

		expect(result).toEqual([])
		expect(warn).toHaveBeenCalledOnce()
	})

	it('returns [] silently when the collection snapshot is empty (curated nothing)', async () => {
		mockedGetCollectionCacheStore.mockReturnValue(makeCollectionStore(snap([])))
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-a': imageA }))
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const result = await fetchTodayMemories({ month: 4, day: 27 })

		expect(result).toEqual([])
		expect(warn).not.toHaveBeenCalled()
	})

	it('attaches direct getpubthumb URLs on images and proxy mediaUrl on videos', async () => {
		mockedGetCollectionCacheStore.mockReturnValue(
			makeCollectionStore(snap(['uuid-a', 'uuid-b', 'uuid-c'])),
		)
		mockedGetMediaCacheStore.mockReturnValue(
			makeMediaStore({
				'uuid-a': imageA, // 2024-04-27 → match
				'uuid-b': imageB, // 2024-06-15 → wrong day
				'uuid-c': videoC, // 2018-04-27 → match
			}),
		)

		const result = await fetchTodayMemories({ month: 4, day: 27 })

		expect(result).toEqual([
			{
				kind: 'image',
				uuid: 'uuid-a',
				name: 'a.jpg',
				captureDate: '2024-04-27T14:30:00.000Z',
				width: 4032,
				height: 3024,
				place: null,
				thumbUrl: thumb640('CODE-A'),
				lightboxUrl: thumb1025('CODE-A'),
			},
			{
				kind: 'video',
				uuid: 'uuid-c',
				contenttype: 'video/mp4',
				name: 'c.mp4',
				captureDate: '2018-04-27T10:00:00.000Z',
				width: 1920,
				height: 1080,
				place: null,
				thumbUrl: thumb640('CODE-C'),
				lightboxUrl: thumb1025('CODE-C'),
				mediaUrl: '/api/video/uuid-c',
			},
		])
	})

	it('passes through null width/height for legacy entries', async () => {
		mockedGetCollectionCacheStore.mockReturnValue(makeCollectionStore(snap(['uuid-b'])))
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-b': imageB }))

		const result = await fetchTodayMemories({ month: 6, day: 15 })

		expect(result).toEqual([
			{
				kind: 'image',
				uuid: 'uuid-b',
				name: 'b.jpg',
				captureDate: '2024-06-15T09:00:00.000Z',
				width: null,
				height: null,
				place: null,
				thumbUrl: thumb640('CODE-B'),
				lightboxUrl: thumb1025('CODE-B'),
			},
		])
	})

	it('passes through place from CachedMedia to MemoryItem', async () => {
		const imageWithPlace: CachedMedia = { ...imageA, place: 'Madrid, España' }
		mockedGetCollectionCacheStore.mockReturnValue(makeCollectionStore(snap(['uuid-a'])))
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-a': imageWithPlace }))

		const result = await fetchTodayMemories({ month: 4, day: 27 })

		expect(result).toHaveLength(1)
		expect(result[0]!.place).toBe('Madrid, España')
	})

	it('breaks ties by fileid ascending when years match', async () => {
		const sameYearOlderFileid: CachedMedia = { ...imageA, fileid: 50 }
		const sameYearLaterFileid: CachedMedia = { ...imageA, fileid: 999, name: 'z.jpg' }
		mockedGetCollectionCacheStore.mockReturnValue(makeCollectionStore(snap(['uuid-z', 'uuid-a'])))
		mockedGetMediaCacheStore.mockReturnValue(
			makeMediaStore({
				'uuid-z': sameYearLaterFileid,
				'uuid-a': sameYearOlderFileid,
			}),
		)

		const result = await fetchTodayMemories({ month: 4, day: 27 })

		expect(result.map((m) => m.name)).toEqual(['a.jpg', 'z.jpg'])
	})

	it('skips uuids whose media-cache entry is missing', async () => {
		mockedGetCollectionCacheStore.mockReturnValue(
			makeCollectionStore(snap(['uuid-a', 'uuid-missing'])),
		)
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-a': imageA }))

		const result = await fetchTodayMemories({ month: 4, day: 27 })

		expect(result.map((m) => m.uuid)).toEqual(['uuid-a'])
	})

	it('skips items whose captureDate is null', async () => {
		mockedGetCollectionCacheStore.mockReturnValue(makeCollectionStore(snap(['uuid-d'])))
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-d': undatedD }))

		const result = await fetchTodayMemories({ month: 4, day: 27 })

		expect(result).toEqual([])
	})

	it('returns [] when no item matches today', async () => {
		mockedGetCollectionCacheStore.mockReturnValue(makeCollectionStore(snap(['uuid-b'])))
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-b': imageB }))

		const result = await fetchTodayMemories({ month: 4, day: 27 })

		expect(result).toEqual([])
	})
})
