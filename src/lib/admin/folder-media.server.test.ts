import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FolderCacheStore, FolderSnapshot } from '../cache/folder-cache'
import type { CachedMedia, MediaCacheStore } from '../cache/media-cache'

import { getFolderCacheStore } from '../cache/folder-cache.server'
import { getMediaCacheStore } from '../cache/media-cache.server'
import { fetchAdminFolderMedia } from './folder-media.server'

vi.mock('../cache/folder-cache.server')
vi.mock('../cache/media-cache.server')

const mockedGetFolderCacheStore = vi.mocked(getFolderCacheStore)
const mockedGetMediaCacheStore = vi.mocked(getMediaCacheStore)

const thumb320 = (code: string) =>
	`https://eapi.pcloud.com/getpubthumb?code=${encodeURIComponent(code)}&size=320x320`

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
	place: 'Madrid, España',
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
	fileid: 50,
	hash: 'h-d',
	code: 'CODE-D',
	linkid: 4000,
	kind: 'image',
	contenttype: 'image/heic',
	name: 'd.heic',
	captureDate: null,
	width: null,
	height: null,
	location: null,
	place: null,
}

beforeEach(() => {
	mockedGetFolderCacheStore.mockReset()
	mockedGetMediaCacheStore.mockReset()
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('fetchAdminFolderMedia', () => {
	it('returns [] when the folder snapshot is missing', async () => {
		mockedGetFolderCacheStore.mockReturnValue(makeFolderStore(undefined))
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore())

		expect(await fetchAdminFolderMedia()).toEqual([])
	})

	it('returns every cached folder item with thumb URL and fileid, no date filter', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({
				refreshedAt: '2026-04-29T04:00:00.000Z',
				uuids: ['uuid-a', 'uuid-b', 'uuid-c'],
			}),
		)
		mockedGetMediaCacheStore.mockReturnValue(
			makeMediaStore({ 'uuid-a': imageA, 'uuid-b': imageB, 'uuid-c': videoC }),
		)

		const result = await fetchAdminFolderMedia()

		expect(result).toEqual([
			{
				uuid: 'uuid-b',
				kind: 'image',
				name: 'b.jpg',
				captureDate: '2024-06-15T09:00:00.000Z',
				fileid: 200,
				thumbUrl: thumb320('CODE-B'),
			},
			{
				uuid: 'uuid-a',
				kind: 'image',
				name: 'a.jpg',
				captureDate: '2024-04-27T14:30:00.000Z',
				fileid: 100,
				thumbUrl: thumb320('CODE-A'),
			},
			{
				uuid: 'uuid-c',
				kind: 'video',
				name: 'c.mp4',
				captureDate: '2018-04-27T10:00:00.000Z',
				fileid: 300,
				thumbUrl: thumb320('CODE-C'),
			},
		])
	})

	it('sorts undated items last, with fileid ascending tiebreak', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({
				refreshedAt: '2026-04-29T04:00:00.000Z',
				uuids: ['uuid-d', 'uuid-a'],
			}),
		)
		mockedGetMediaCacheStore.mockReturnValue(
			makeMediaStore({ 'uuid-a': imageA, 'uuid-d': undatedD }),
		)

		const result = await fetchAdminFolderMedia()

		expect(result.map((m) => m.uuid)).toEqual(['uuid-a', 'uuid-d'])
	})

	it('skips uuids whose media-cache entry is missing', async () => {
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({
				refreshedAt: '2026-04-29T04:00:00.000Z',
				uuids: ['uuid-a', 'uuid-missing'],
			}),
		)
		mockedGetMediaCacheStore.mockReturnValue(makeMediaStore({ 'uuid-a': imageA }))

		const result = await fetchAdminFolderMedia()

		expect(result.map((m) => m.uuid)).toEqual(['uuid-a'])
	})

	it('breaks ties on equal captureDate by fileid ascending', async () => {
		const aOlderFileid: CachedMedia = { ...imageA, fileid: 50 }
		const aLaterFileid: CachedMedia = {
			...imageA,
			fileid: 999,
			name: 'a-later.jpg',
			code: 'CODE-A2',
		}
		mockedGetFolderCacheStore.mockReturnValue(
			makeFolderStore({
				refreshedAt: '2026-04-29T04:00:00.000Z',
				uuids: ['uuid-later', 'uuid-older'],
			}),
		)
		mockedGetMediaCacheStore.mockReturnValue(
			makeMediaStore({ 'uuid-later': aLaterFileid, 'uuid-older': aOlderFileid }),
		)

		const result = await fetchAdminFolderMedia()

		expect(result.map((m) => m.fileid)).toEqual([50, 999])
	})
})
