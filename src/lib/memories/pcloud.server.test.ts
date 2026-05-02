import type { Client } from 'pcloud-kit'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FolderCacheStore, FolderSnapshot } from '../cache/folder-cache'
import type { CachedMedia, MediaCacheStore } from '../cache/media-cache'

import { getFolderCacheStore } from '../cache/folder-cache.server'
import { getMediaCacheStore } from '../cache/media-cache.server'
import { resolveMediaUrl, resolveThumbUrl } from './pcloud-urls.server'
import { fetchTodayMemories } from './pcloud.server'

vi.mock('../cache/folder-cache.server')
vi.mock('../cache/media-cache.server')
vi.mock('./pcloud-urls.server')

const mockedGetFolderCacheStore = vi.mocked(getFolderCacheStore)
const mockedGetMediaCacheStore = vi.mocked(getMediaCacheStore)
const mockedResolveThumbUrl = vi.mocked(resolveThumbUrl)
const mockedResolveMediaUrl = vi.mocked(resolveMediaUrl)

const fakeClient = {} as Client

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

function makeFolderStore(snapshot: FolderSnapshot | undefined = undefined) {
	const state: { value: FolderSnapshot | undefined } = { value: snapshot }
	return {
		get: vi.fn<FolderCacheStore['get']>(async () => state.value),
		set: vi.fn<FolderCacheStore['set']>(async (next) => {
			state.value = next
		}),
		state,
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

beforeEach(() => {
	mockedGetFolderCacheStore.mockReset()
	mockedGetMediaCacheStore.mockReset()
	mockedResolveThumbUrl.mockImplementation(
		async (_client, code, size) => `https://thumb.${size}.${code}`,
	)
	mockedResolveMediaUrl.mockImplementation(async (_client, code) => `https://media.${code}`)
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('fetchTodayMemories', () => {
	it('returns [] and warns when the folder snapshot is missing', async () => {
		mockedGetFolderCacheStore.mockReturnValue(makeFolderStore(undefined))
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore())
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const result = await fetchTodayMemories({ month: 4, day: 27 }, fakeClient)

		expect(result).toEqual([])
		expect(warn).toHaveBeenCalledOnce()
	})

	it('attaches thumbUrl + lightboxUrl on images and additionally mediaUrl on videos', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({
				refreshedAt: '2026-04-29T04:00:00.000Z',
				uuids: ['uuid-a', 'uuid-b', 'uuid-c'],
			}),
		)
		mockedGetMediaCacheStore.mockReturnValue(
			makeMediaStore({
				'uuid-a': imageA, // 2024-04-27 → match
				'uuid-b': imageB, // 2024-06-15 → wrong day
				'uuid-c': videoC, // 2018-04-27 → match
			}),
		)

		const result = await fetchTodayMemories({ month: 4, day: 27 }, fakeClient)

		expect(result).toEqual([
			{
				kind: 'video',
				uuid: 'uuid-c',
				contenttype: 'video/mp4',
				name: 'c.mp4',
				captureDate: '2018-04-27T10:00:00.000Z',
				width: 1920,
				height: 1080,
				place: null,
				thumbUrl: 'https://thumb.640x640.CODE-C',
				lightboxUrl: 'https://thumb.1025x1025.CODE-C',
				mediaUrl: 'https://media.CODE-C',
			},
			{
				kind: 'image',
				uuid: 'uuid-a',
				name: 'a.jpg',
				captureDate: '2024-04-27T14:30:00.000Z',
				width: 4032,
				height: 3024,
				place: null,
				thumbUrl: 'https://thumb.640x640.CODE-A',
				lightboxUrl: 'https://thumb.1025x1025.CODE-A',
			},
		])
	})

	it('does not call resolveMediaUrl for image-only matches', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({ refreshedAt: '2026-04-29T04:00:00.000Z', uuids: ['uuid-a'] }),
		)
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-a': imageA }))

		await fetchTodayMemories({ month: 4, day: 27 }, fakeClient)

		expect(mockedResolveMediaUrl).not.toHaveBeenCalled()
	})

	it('drops items whose URL resolution fails and keeps the rest', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({ refreshedAt: '2026-04-29T04:00:00.000Z', uuids: ['uuid-a', 'uuid-c'] }),
		)
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-a': imageA, 'uuid-c': videoC }))
		mockedResolveThumbUrl.mockImplementation(async (_client, code, size) => {
			if (code === 'CODE-A' && size === '1025x1025') throw new Error('1025 rejected')
			return `https://thumb.${size}.${code}`
		})
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const result = await fetchTodayMemories({ month: 4, day: 27 }, fakeClient)

		expect(result.map((m) => m.uuid)).toEqual(['uuid-c'])
		expect(warn).toHaveBeenCalled()
	})

	it('drops a video whose mediaUrl resolution fails', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({ refreshedAt: '2026-04-29T04:00:00.000Z', uuids: ['uuid-a', 'uuid-c'] }),
		)
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-a': imageA, 'uuid-c': videoC }))
		mockedResolveMediaUrl.mockRejectedValue(new Error('publinkdownload failed'))
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const result = await fetchTodayMemories({ month: 4, day: 27 }, fakeClient)

		expect(result.map((m) => m.uuid)).toEqual(['uuid-a'])
		expect(warn).toHaveBeenCalled()
	})

	it('passes through null width/height for legacy entries', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({ refreshedAt: '2026-04-29T04:00:00.000Z', uuids: ['uuid-b'] }),
		)
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-b': imageB }))

		const result = await fetchTodayMemories({ month: 6, day: 15 }, fakeClient)

		expect(result).toEqual([
			{
				kind: 'image',
				uuid: 'uuid-b',
				name: 'b.jpg',
				captureDate: '2024-06-15T09:00:00.000Z',
				width: null,
				height: null,
				place: null,
				thumbUrl: 'https://thumb.640x640.CODE-B',
				lightboxUrl: 'https://thumb.1025x1025.CODE-B',
			},
		])
	})

	it('passes through place from CachedMedia to MemoryItem', async () => {
		const imageWithPlace: CachedMedia = { ...imageA, place: 'Madrid, España' }
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({ refreshedAt: '2026-04-29T04:00:00.000Z', uuids: ['uuid-a'] }),
		)
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-a': imageWithPlace }))

		const result = await fetchTodayMemories({ month: 4, day: 27 }, fakeClient)

		expect(result).toHaveLength(1)
		expect(result[0]!.place).toBe('Madrid, España')
	})

	it('breaks ties by fileid ascending when years match', async () => {
		const sameYearOlderFileid: CachedMedia = { ...imageA, fileid: 50 }
		const sameYearLaterFileid: CachedMedia = { ...imageA, fileid: 999, name: 'z.jpg' }
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({
				refreshedAt: '2026-04-29T04:00:00.000Z',
				uuids: ['uuid-z', 'uuid-a'],
			}),
		)
		mockedGetMediaCacheStore.mockReturnValue(
			makeMediaStore({
				'uuid-z': sameYearLaterFileid,
				'uuid-a': sameYearOlderFileid,
			}),
		)

		const result = await fetchTodayMemories({ month: 4, day: 27 }, fakeClient)

		expect(result.map((m) => m.name)).toEqual(['a.jpg', 'z.jpg'])
	})

	it('skips uuids whose media-cache entry is missing', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({
				refreshedAt: '2026-04-29T04:00:00.000Z',
				uuids: ['uuid-a', 'uuid-missing'],
			}),
		)
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-a': imageA }))

		const result = await fetchTodayMemories({ month: 4, day: 27 }, fakeClient)

		expect(result.map((m) => m.uuid)).toEqual(['uuid-a'])
	})

	it('skips items whose captureDate is null', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({ refreshedAt: '2026-04-29T04:00:00.000Z', uuids: ['uuid-d'] }),
		)
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-d': undatedD }))

		const result = await fetchTodayMemories({ month: 4, day: 27 }, fakeClient)

		expect(result).toEqual([])
	})

	it('returns [] when no item matches today', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({ refreshedAt: '2026-04-29T04:00:00.000Z', uuids: ['uuid-b'] }),
		)
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-b': imageB }))

		const result = await fetchTodayMemories({ month: 4, day: 27 }, fakeClient)

		expect(result).toEqual([])
	})
})
