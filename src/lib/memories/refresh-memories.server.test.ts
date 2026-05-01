import type { Client, FileMetadata, FolderMetadata } from 'pcloud-kit'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileidIndexStore } from '../cache/fileid-index'
import type { FolderCacheStore, FolderSnapshot } from '../cache/folder-cache'
import type { CachedMedia, MediaCacheStore } from '../cache/media-cache'
import type { ReverseGeocodeResult } from '../media-meta/geoapify.server'

import { createFileidIndex } from '../cache/fileid-index'
import { createFolderCache } from '../cache/folder-cache'
import { createMediaCache } from '../cache/media-cache'
import { extractImageMeta } from '../media-meta/exif'
import { extractVideoMeta } from '../media-meta/video-meta'
import { refreshMemories } from './refresh-memories.server'

type Geocoder = (
	input: { lat: number; lng: number },
	opts: { apiKey: string },
) => Promise<ReverseGeocodeResult>
type Sleeper = (ms: number) => Promise<void>

vi.mock('../media-meta/exif')
vi.mock('../media-meta/video-meta')

const mockedExtractImageMeta = vi.mocked(extractImageMeta)
const mockedExtractVideoMeta = vi.mocked(extractVideoMeta)

function makeMediaStore() {
	const data = new Map<string, CachedMedia>()
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

function makeFileidStore() {
	const data = new Map<number, { uuid: string }>()
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

function makeFolderStore() {
	const state: { value: FolderSnapshot | undefined } = { value: undefined }
	return {
		get: vi.fn<FolderCacheStore['get']>(async () => state.value),
		set: vi.fn<FolderCacheStore['set']>(async (next) => {
			state.value = next
		}),
		state,
	}
}

function makeFile(
	overrides: Partial<FileMetadata> & Pick<FileMetadata, 'fileid' | 'name' | 'contenttype' | 'hash'>,
): FileMetadata {
	return {
		parentfolderid: 0,
		isfolder: false,
		size: 0,
		category: 0,
		id: '',
		isshared: false,
		icon: '',
		created: '',
		modified: '',
		...overrides,
	}
}

function makeFolderResult(
	contents: Array<FileMetadata | FolderMetadata> | undefined,
): FolderMetadata {
	return {
		isfolder: true,
		folderid: 0,
		name: 'root',
		id: '',
		isshared: false,
		icon: '',
		created: '',
		modified: '',
		contents,
	}
}

type FakeClientOverrides = {
	files?: FileMetadata[]
	getfilepublink?: (fileid: number) => Promise<{ code: string; linkid: number }>
	deletepublink?: (linkid: number) => Promise<void>
}

function fakeClient(overrides: FakeClientOverrides = {}): Client {
	const files = overrides.files ?? []
	const getfilepublink =
		overrides.getfilepublink ??
		(async (fileid) => ({ code: `code-${fileid}`, linkid: fileid * 10 }))
	const deletepublink = overrides.deletepublink ?? (async () => {})
	return {
		listfolder: vi
			.fn<Client['listfolder']>()
			.mockResolvedValue(makeFolderResult(files) as Awaited<ReturnType<Client['listfolder']>>),
		getfilelink: vi
			.fn<Client['getfilelink']>()
			.mockImplementation(async (id: number) => `https://download/${id}`),
		call: vi.fn<Client['call']>().mockImplementation(async (method: string, params: unknown) => {
			if (method === 'getfilepublink') {
				const p = params as { fileid: number }
				return getfilepublink(p.fileid)
			}
			if (method === 'deletepublink') {
				const p = params as { linkid: number }
				await deletepublink(p.linkid)
				return { result: 0 }
			}
			throw new Error(`unexpected pCloud method in tests: ${method}`)
		}) as unknown as Client['call'],
	} as unknown as Client
}

const jpegA = makeFile({ fileid: 100, name: 'a.jpg', contenttype: 'image/jpeg', hash: 'h-a' })
const mp4B = makeFile({ fileid: 200, name: 'b.mp4', contenttype: 'video/mp4', hash: 'h-b' })

beforeEach(() => {
	mockedExtractImageMeta.mockResolvedValue({
		captureDate: new Date('2020-01-15T10:00:00Z'),
		width: 4032,
		height: 3024,
		location: null,
	})
	mockedExtractVideoMeta.mockResolvedValue({
		captureDate: new Date('2018-04-27T10:00:00Z'),
		width: 1920,
		height: 1080,
		location: null,
	})
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('refreshMemories', () => {
	it('mints a uuid + creates a public link for a brand-new file', async () => {
		const mediaStore = makeMediaStore()
		const fileidStore = makeFileidStore()
		const folderStore = makeFolderStore()
		const client = fakeClient({ files: [jpegA] })

		const result = await refreshMemories(
			client,
			42,
			createMediaCache(mediaStore),
			createFileidIndex(fileidStore),
			createFolderCache(folderStore),
		)

		expect(result).toMatchObject({ scanned: 1, alive: 1, removed: 0 })
		expect(mediaStore.set).toHaveBeenCalledTimes(1)
		const [uuid, meta] = mediaStore.set.mock.calls[0]!
		expect(meta).toEqual({
			fileid: 100,
			hash: 'h-a',
			code: 'code-100',
			linkid: 1000,
			kind: 'image',
			contenttype: 'image/jpeg',
			name: 'a.jpg',
			captureDate: '2020-01-15T10:00:00.000Z',
			width: 4032,
			height: 3024,
			location: null,
			place: null,
		})
		expect(fileidStore.set).toHaveBeenCalledWith(100, { uuid })
		expect(folderStore.set).toHaveBeenCalledTimes(1)
		expect(folderStore.set.mock.calls[0]![0].uuids).toEqual([uuid])
	})

	it('reuses an existing uuid across runs (rename ≠ new uuid)', async () => {
		const mediaStore = makeMediaStore()
		const fileidStore = makeFileidStore()
		const folderStore = makeFolderStore()
		fileidStore.data.set(100, { uuid: 'stable-uuid' })
		mediaStore.data.set('stable-uuid', {
			fileid: 100,
			hash: 'h-a',
			code: 'code-100',
			linkid: 1000,
			kind: 'image',
			contenttype: 'image/jpeg',
			name: 'a.jpg',
			captureDate: '2020-01-15T10:00:00.000Z',
			width: 4032,
			height: 3024,
			location: null,
			place: null,
		})
		const client = fakeClient({ files: [jpegA] })

		const result = await refreshMemories(
			client,
			42,
			createMediaCache(mediaStore),
			createFileidIndex(fileidStore),
			createFolderCache(folderStore),
		)

		expect(result.scanned).toBe(1)
		expect(mediaStore.set).not.toHaveBeenCalled()
		expect(fileidStore.set).not.toHaveBeenCalled()
		expect(mockedExtractImageMeta).not.toHaveBeenCalled()
		expect(client.call).not.toHaveBeenCalledWith('getfilepublink', expect.anything())
		expect(folderStore.set.mock.calls[0]![0].uuids).toEqual(['stable-uuid'])
	})

	it('overwrites the cached entry when hash changes (content updated, same fileid)', async () => {
		const mediaStore = makeMediaStore()
		const fileidStore = makeFileidStore()
		const folderStore = makeFolderStore()
		fileidStore.data.set(100, { uuid: 'stable-uuid' })
		mediaStore.data.set('stable-uuid', {
			fileid: 100,
			hash: 'OLD-HASH',
			code: 'code-100',
			linkid: 1000,
			kind: 'image',
			contenttype: 'image/jpeg',
			name: 'a.jpg',
			captureDate: '2018-01-01T00:00:00.000Z',
			width: null,
			height: null,
			location: null,
			place: null,
		})
		const client = fakeClient({ files: [jpegA] })
		mockedExtractImageMeta.mockResolvedValueOnce({
			captureDate: new Date('2021-04-27T10:00:00Z'),
			width: 6000,
			height: 4000,
			location: null,
		})

		await refreshMemories(
			client,
			42,
			createMediaCache(mediaStore),
			createFileidIndex(fileidStore),
			createFolderCache(folderStore),
		)

		expect(mediaStore.set).toHaveBeenCalledTimes(1)
		const [, meta] = mediaStore.set.mock.calls[0]!
		expect(meta).toMatchObject({
			fileid: 100,
			hash: 'h-a',
			code: 'code-100',
			linkid: 1000,
			captureDate: '2021-04-27T10:00:00.000Z',
			width: 6000,
			height: 4000,
		})
		expect(client.call).not.toHaveBeenCalledWith('getfilepublink', expect.anything())
	})

	it('writes null width/height when the extractor returns null dims', async () => {
		const mediaStore = makeMediaStore()
		const fileidStore = makeFileidStore()
		const folderStore = makeFolderStore()
		const client = fakeClient({ files: [jpegA] })
		mockedExtractImageMeta.mockResolvedValueOnce({
			captureDate: new Date('2020-01-15T10:00:00Z'),
			width: null,
			height: null,
			location: null,
		})

		await refreshMemories(
			client,
			42,
			createMediaCache(mediaStore),
			createFileidIndex(fileidStore),
			createFolderCache(folderStore),
		)

		const [, meta] = mediaStore.set.mock.calls[0]!
		expect(meta.width).toBeNull()
		expect(meta.height).toBeNull()
	})

	it('sweeps stale uuids: deletes public link + clears caches', async () => {
		const mediaStore = makeMediaStore()
		const fileidStore = makeFileidStore()
		const folderStore = makeFolderStore()
		fileidStore.data.set(999, { uuid: 'stale-uuid' })
		mediaStore.data.set('stale-uuid', {
			fileid: 999,
			hash: 'gone',
			code: 'stale-code',
			linkid: 9990,
			kind: 'image',
			contenttype: 'image/jpeg',
			name: 'gone.jpg',
			captureDate: null,
			width: null,
			height: null,
			location: null,
			place: null,
		})
		const deleted: number[] = []
		const client = fakeClient({
			files: [jpegA],
			deletepublink: async (linkid) => {
				deleted.push(linkid)
			},
		})

		const result = await refreshMemories(
			client,
			42,
			createMediaCache(mediaStore),
			createFileidIndex(fileidStore),
			createFolderCache(folderStore),
		)

		expect(result).toMatchObject({ scanned: 1, alive: 1, removed: 1 })
		expect(deleted).toEqual([9990])
		expect(mediaStore.delete).toHaveBeenCalledWith('stale-uuid')
		expect(fileidStore.delete).toHaveBeenCalledWith(999)
		expect(folderStore.set.mock.calls[0]![0].uuids).toHaveLength(1)
		expect(folderStore.set.mock.calls[0]![0].uuids[0]).not.toBe('stale-uuid')
	})

	it('still clears the cache when deletepublink throws (best-effort)', async () => {
		const mediaStore = makeMediaStore()
		const fileidStore = makeFileidStore()
		const folderStore = makeFolderStore()
		fileidStore.data.set(999, { uuid: 'stale-uuid' })
		mediaStore.data.set('stale-uuid', {
			fileid: 999,
			hash: 'gone',
			code: 'stale-code',
			linkid: 9990,
			kind: 'image',
			contenttype: 'image/jpeg',
			name: 'gone.jpg',
			captureDate: null,
			width: null,
			height: null,
			location: null,
			place: null,
		})
		const client = fakeClient({
			files: [],
			deletepublink: async () => {
				throw new Error('already deleted')
			},
		})

		const result = await refreshMemories(
			client,
			42,
			createMediaCache(mediaStore),
			createFileidIndex(fileidStore),
			createFolderCache(folderStore),
		)

		expect(result.removed).toBe(1)
		expect(mediaStore.delete).toHaveBeenCalledWith('stale-uuid')
		expect(fileidStore.delete).toHaveBeenCalledWith(999)
	})

	it('persists location from the image extractor onto CachedMedia', async () => {
		const mediaStore = makeMediaStore()
		const fileidStore = makeFileidStore()
		const folderStore = makeFolderStore()
		const client = fakeClient({ files: [jpegA] })
		mockedExtractImageMeta.mockResolvedValueOnce({
			captureDate: new Date('2020-01-15T10:00:00Z'),
			width: 4032,
			height: 3024,
			location: { lat: 40.4168, lng: -3.7038 },
		})

		await refreshMemories(
			client,
			42,
			createMediaCache(mediaStore),
			createFileidIndex(fileidStore),
			createFolderCache(folderStore),
		)

		const [, meta] = mediaStore.set.mock.calls[0]!
		expect(meta.location).toEqual({ lat: 40.4168, lng: -3.7038 })
		expect(meta.place).toBeNull()
	})

	it('persists location from the video extractor onto CachedMedia', async () => {
		const mediaStore = makeMediaStore()
		const fileidStore = makeFileidStore()
		const folderStore = makeFolderStore()
		const client = fakeClient({ files: [mp4B] })
		mockedExtractVideoMeta.mockResolvedValueOnce({
			captureDate: new Date('2018-04-27T10:00:00Z'),
			width: 1920,
			height: 1080,
			location: { lat: 38.7169, lng: -9.1399 },
		})

		await refreshMemories(
			client,
			42,
			createMediaCache(mediaStore),
			createFileidIndex(fileidStore),
			createFolderCache(folderStore),
		)

		const [, meta] = mediaStore.set.mock.calls[0]!
		expect(meta.location).toEqual({ lat: 38.7169, lng: -9.1399 })
		expect(meta.place).toBeNull()
	})

	it('uses the video extractor for video files', async () => {
		const mediaStore = makeMediaStore()
		const fileidStore = makeFileidStore()
		const folderStore = makeFolderStore()
		const client = fakeClient({ files: [mp4B] })

		await refreshMemories(
			client,
			42,
			createMediaCache(mediaStore),
			createFileidIndex(fileidStore),
			createFolderCache(folderStore),
		)

		expect(mockedExtractVideoMeta).toHaveBeenCalled()
		expect(mockedExtractImageMeta).not.toHaveBeenCalled()
		const [, meta] = mediaStore.set.mock.calls[0]!
		expect(meta.kind).toBe('video')
		expect(meta.contenttype).toBe('video/mp4')
		expect(meta.width).toBe(1920)
		expect(meta.height).toBe(1080)
	})

	describe('extract counts', () => {
		const ZERO = {
			imagesWithLocation: 0,
			imagesNoLocation: 0,
			imagesExtractError: 0,
			videosWithLocation: 0,
			videosNoLocation: 0,
			videosExtractError: 0,
		}

		it('returns zeroed counts for an empty folder', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			const client = fakeClient({ files: [] })

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
			)

			expect(result.extractCounts).toEqual(ZERO)
		})

		it('counts a freshly-extracted image with GPS as imagesWithLocation', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			mockedExtractImageMeta.mockResolvedValueOnce({
				captureDate: new Date('2020-01-15T10:00:00Z'),
				width: 4032,
				height: 3024,
				location: { lat: 40.4168, lng: -3.7038 },
			})
			const client = fakeClient({ files: [jpegA] })

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
			)

			expect(result.extractCounts).toEqual({ ...ZERO, imagesWithLocation: 1 })
		})

		it('counts a freshly-extracted image without GPS as imagesNoLocation', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			// default mock returns location: null
			const client = fakeClient({ files: [jpegA] })

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
			)

			expect(result.extractCounts).toEqual({ ...ZERO, imagesNoLocation: 1 })
		})

		it('counts an image extractor throw as imagesExtractError', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			mockedExtractImageMeta.mockRejectedValueOnce(new Error('boom'))
			const client = fakeClient({ files: [jpegA] })

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
			)

			expect(result.extractCounts).toEqual({ ...ZERO, imagesExtractError: 1 })
		})

		it('counts a video with GPS as videosWithLocation', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			mockedExtractVideoMeta.mockResolvedValueOnce({
				captureDate: new Date('2018-04-27T10:00:00Z'),
				width: 1920,
				height: 1080,
				location: { lat: 38.7169, lng: -9.1399 },
			})
			const client = fakeClient({ files: [mp4B] })

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
			)

			expect(result.extractCounts).toEqual({ ...ZERO, videosWithLocation: 1 })
		})

		it('counts a video without GPS as videosNoLocation', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			// default mock returns location: null
			const client = fakeClient({ files: [mp4B] })

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
			)

			expect(result.extractCounts).toEqual({ ...ZERO, videosNoLocation: 1 })
		})

		it('counts a video extractor throw as videosExtractError', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			mockedExtractVideoMeta.mockRejectedValueOnce(new Error('boom'))
			const client = fakeClient({ files: [mp4B] })

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
			)

			expect(result.extractCounts).toEqual({ ...ZERO, videosExtractError: 1 })
		})

		it('does not count cache-hit (unchanged) entries', async () => {
			// File already cached at the same hash → skip the extractor entirely.
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			fileidStore.data.set(100, { uuid: 'stable-uuid' })
			mediaStore.data.set('stable-uuid', {
				fileid: 100,
				hash: 'h-a',
				code: 'code-100',
				linkid: 1000,
				kind: 'image',
				contenttype: 'image/jpeg',
				name: 'a.jpg',
				captureDate: '2020-01-15T10:00:00.000Z',
				width: 4032,
				height: 3024,
				location: null,
				place: null,
			})
			const client = fakeClient({ files: [jpegA] })

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
			)

			expect(result.extractCounts).toEqual(ZERO)
		})

		it('aggregates mixed outcomes across files', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			const jpegC = makeFile({
				fileid: 102,
				name: 'c.jpg',
				contenttype: 'image/jpeg',
				hash: 'h-c',
			})
			mockedExtractImageMeta
				.mockResolvedValueOnce({
					captureDate: new Date('2020-01-15T10:00:00Z'),
					width: 100,
					height: 100,
					location: { lat: 40, lng: -3 },
				})
				.mockResolvedValueOnce({
					captureDate: new Date('2020-01-15T10:00:00Z'),
					width: 100,
					height: 100,
					location: null,
				})
			mockedExtractVideoMeta.mockRejectedValueOnce(new Error('boom'))
			const client = fakeClient({ files: [jpegA, jpegC, mp4B] })

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
			)

			expect(result.extractCounts).toEqual({
				...ZERO,
				imagesWithLocation: 1,
				imagesNoLocation: 1,
				videosExtractError: 1,
			})
		})
	})

	describe('geocode pass', () => {
		const APIKEY = 'test-key'
		const MADRID = { lat: 40.4168, lng: -3.7038 }
		const LISBON = { lat: 38.7169, lng: -9.1399 }

		function setupGpsImage(): void {
			mockedExtractImageMeta.mockResolvedValue({
				captureDate: new Date('2020-01-15T10:00:00Z'),
				width: 4032,
				height: 3024,
				location: MADRID,
			})
		}

		it('skips the geocode pass when no geocodeOpts are provided', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			setupGpsImage()
			const client = fakeClient({ files: [jpegA] })
			const geocoder = vi.fn<Geocoder>()

			await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
			)

			expect(geocoder).not.toHaveBeenCalled()
		})

		it('geocodes a fresh GPS entry and re-writes the cache with place set', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			setupGpsImage()
			const client = fakeClient({ files: [jpegA] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: true, place: 'Madrid, España' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			expect(geocoder).toHaveBeenCalledTimes(1)
			expect(geocoder).toHaveBeenCalledWith(MADRID, { apiKey: APIKEY })
			expect(result.geocoded).toBe(1)
			// First write is the file pass (place: null), second is the geocode pass
			// (place set). The cache ends with place set.
			expect(mediaStore.set).toHaveBeenCalledTimes(2)
			const finalMeta = Array.from(mediaStore.data.values())[0]!
			expect(finalMeta.place).toBe('Madrid, España')
			expect(finalMeta.location).toEqual(MADRID)
		})

		it('does not call the geocoder for entries with no location', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			mockedExtractImageMeta.mockResolvedValue({
				captureDate: new Date('2020-01-15T10:00:00Z'),
				width: 4032,
				height: 3024,
				location: null,
			})
			const client = fakeClient({ files: [jpegA] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: true, place: 'X' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			expect(geocoder).not.toHaveBeenCalled()
		})

		it('does not call the geocoder for entries that already have place from a prior run', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			fileidStore.data.set(100, { uuid: 'stable-uuid' })
			mediaStore.data.set('stable-uuid', {
				fileid: 100,
				hash: 'h-a',
				code: 'code-100',
				linkid: 1000,
				kind: 'image',
				contenttype: 'image/jpeg',
				name: 'a.jpg',
				captureDate: '2020-01-15T10:00:00.000Z',
				width: 4032,
				height: 3024,
				location: MADRID,
				place: 'Madrid, España',
			})
			const client = fakeClient({ files: [jpegA] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: true, place: 'X' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			expect(geocoder).not.toHaveBeenCalled()
		})

		it('sleeps between consecutive geocode calls', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			const jpegB = makeFile({
				fileid: 101,
				name: 'b.jpg',
				contenttype: 'image/jpeg',
				hash: 'h-b',
			})
			mockedExtractImageMeta
				.mockResolvedValueOnce({
					captureDate: new Date('2020-01-15T10:00:00Z'),
					width: 100,
					height: 100,
					location: MADRID,
				})
				.mockResolvedValueOnce({
					captureDate: new Date('2020-01-15T10:00:00Z'),
					width: 100,
					height: 100,
					location: LISBON,
				})
			const client = fakeClient({ files: [jpegA, jpegB] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: true, place: 'X' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep, sleepMs: 1100 },
			)

			expect(geocoder).toHaveBeenCalledTimes(2)
			// Sleep is called once between the two calls, not before the first
			// or after the last.
			expect(sleep).toHaveBeenCalledTimes(1)
			expect(sleep).toHaveBeenCalledWith(1100)
		})

		it('respects the cap and leaves remaining items with place: null', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			const jpegB = makeFile({
				fileid: 101,
				name: 'b.jpg',
				contenttype: 'image/jpeg',
				hash: 'h-b',
			})
			mockedExtractImageMeta.mockResolvedValue({
				captureDate: new Date('2020-01-15T10:00:00Z'),
				width: 100,
				height: 100,
				location: MADRID,
			})
			const client = fakeClient({ files: [jpegA, jpegB] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: true, place: 'X' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep, cap: 1 },
			)

			expect(geocoder).toHaveBeenCalledTimes(1)
			expect(result.geocoded).toBe(1)
			expect(result.geocodeCapped).toBe(1)
		})

		it('stops the pass on ratelimit and counts remaining work as not-attempted', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			const jpegB = makeFile({
				fileid: 101,
				name: 'b.jpg',
				contenttype: 'image/jpeg',
				hash: 'h-b',
			})
			mockedExtractImageMeta.mockResolvedValue({
				captureDate: new Date('2020-01-15T10:00:00Z'),
				width: 100,
				height: 100,
				location: MADRID,
			})
			const client = fakeClient({ files: [jpegA, jpegB] })
			const geocoder = vi.fn<Geocoder>()
			geocoder.mockResolvedValueOnce({ ok: true, place: 'X' })
			geocoder.mockResolvedValueOnce({ ok: false, reason: 'ratelimit' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			expect(geocoder).toHaveBeenCalledTimes(2)
			expect(result.geocoded).toBe(1)
			expect(result.geocodeFailures.ratelimit).toBe(1)
			expect(result.geocodeStoppedReason).toBe('ratelimit')
		})

		it('stops the pass on auth and warns once', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			const jpegB = makeFile({
				fileid: 101,
				name: 'b.jpg',
				contenttype: 'image/jpeg',
				hash: 'h-b',
			})
			mockedExtractImageMeta.mockResolvedValue({
				captureDate: new Date('2020-01-15T10:00:00Z'),
				width: 100,
				height: 100,
				location: MADRID,
			})
			const client = fakeClient({ files: [jpegA, jpegB] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: false, reason: 'auth' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			expect(geocoder).toHaveBeenCalledTimes(1)
			expect(result.geocodeFailures.auth).toBe(1)
			expect(result.geocodeStoppedReason).toBe('auth')
			expect(warn).toHaveBeenCalledTimes(1)
			// Warn line must not contain coords or messages.
			const warnArg = String(warn.mock.calls[0]![0])
			expect(warnArg).not.toContain('40.4')
			expect(warnArg).not.toContain('-3.7')
			warn.mockRestore()
		})

		it('counts transient server failures and continues with the next item', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			const jpegB = makeFile({
				fileid: 101,
				name: 'b.jpg',
				contenttype: 'image/jpeg',
				hash: 'h-b',
			})
			mockedExtractImageMeta.mockResolvedValue({
				captureDate: new Date('2020-01-15T10:00:00Z'),
				width: 100,
				height: 100,
				location: MADRID,
			})
			const client = fakeClient({ files: [jpegA, jpegB] })
			const geocoder = vi.fn<Geocoder>()
			geocoder.mockResolvedValueOnce({ ok: false, reason: 'server' })
			geocoder.mockResolvedValueOnce({ ok: true, place: 'Madrid, España' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			expect(geocoder).toHaveBeenCalledTimes(2)
			expect(result.geocoded).toBe(1)
			expect(result.geocodeFailures.server).toBe(1)
			expect(result.geocodeStoppedReason).toBeNull()
		})

		it('does not write the cache when the geocoder returns ok with null place', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			setupGpsImage()
			const client = fakeClient({ files: [jpegA] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: true, place: null })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			// Only the initial file-pass write — no second write from the geocode pass.
			expect(mediaStore.set).toHaveBeenCalledTimes(1)
			const finalMeta = Array.from(mediaStore.data.values())[0]!
			expect(finalMeta.place).toBeNull()
			// The 200-OK-with-null-place path is no longer silent: it bumps
			// geocodeNoPlace so the cron summary surfaces the count.
			expect(result.geocodeNoPlace).toBe(1)
			expect(result.geocoded).toBe(0)
		})

		it('does not bump geocodeNoPlace when the geocoder fills in a place', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			setupGpsImage()
			const client = fakeClient({ files: [jpegA] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: true, place: 'Madrid, España' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			expect(result.geocoded).toBe(1)
			expect(result.geocodeNoPlace).toBe(0)
		})

		it('reports skip-reason counters: alreadyDone for entries with place set, noLocation for entries without GPS, attempted for the rest', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			const jpegB = makeFile({
				fileid: 101,
				name: 'b.jpg',
				contenttype: 'image/jpeg',
				hash: 'h-b',
			})
			const jpegC = makeFile({
				fileid: 102,
				name: 'c.jpg',
				contenttype: 'image/jpeg',
				hash: 'h-c',
			})
			// jpegA: existing entry with place already set → skipAlreadyDone
			fileidStore.data.set(100, { uuid: 'uuid-A' })
			mediaStore.data.set('uuid-A', {
				fileid: 100,
				hash: 'h-a',
				code: 'code-100',
				linkid: 1000,
				kind: 'image',
				contenttype: 'image/jpeg',
				name: 'a.jpg',
				captureDate: '2020-01-15T10:00:00.000Z',
				width: 4032,
				height: 3024,
				location: MADRID,
				place: 'Madrid, España',
			})
			// jpegB: no GPS → skipNoLocation
			// jpegC: GPS, no place → attempted
			mockedExtractImageMeta
				.mockResolvedValueOnce({
					captureDate: new Date('2020-01-15T10:00:00Z'),
					width: 100,
					height: 100,
					location: null,
				})
				.mockResolvedValueOnce({
					captureDate: new Date('2020-01-15T10:00:00Z'),
					width: 100,
					height: 100,
					location: LISBON,
				})
			const client = fakeClient({ files: [jpegA, jpegB, jpegC] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: true, place: 'Lisboa, Portugal' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			expect(result.geocodeAttempted).toBe(1)
			expect(result.geocodeSkippedNoCached).toBe(0)
			expect(result.geocodeSkippedNoLocation).toBe(1)
			expect(result.geocodeSkippedAlreadyDone).toBe(1)
			expect(result.geocodeSkippedAfterStop).toBe(0)
		})

		it('counts skipAfterStop for items iterated after a stop reason fires', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			const jpegB = makeFile({
				fileid: 101,
				name: 'b.jpg',
				contenttype: 'image/jpeg',
				hash: 'h-b',
			})
			mockedExtractImageMeta.mockResolvedValue({
				captureDate: new Date('2020-01-15T10:00:00Z'),
				width: 100,
				height: 100,
				location: MADRID,
			})
			const client = fakeClient({ files: [jpegA, jpegB] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: false, reason: 'auth' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			// First entry: attempted, returns auth → stopped is set.
			// Second entry: hits the `stopped !== null` continue → skipAfterStop bumps.
			expect(result.geocodeAttempted).toBe(1)
			expect(result.geocodeSkippedAfterStop).toBe(1)
			warn.mockRestore()
		})

		it('aggregates geocodeNoPlace across multiple null-place responses', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			const jpegB = makeFile({
				fileid: 101,
				name: 'b.jpg',
				contenttype: 'image/jpeg',
				hash: 'h-b',
			})
			mockedExtractImageMeta.mockResolvedValue({
				captureDate: new Date('2020-01-15T10:00:00Z'),
				width: 100,
				height: 100,
				location: MADRID,
			})
			const client = fakeClient({ files: [jpegA, jpegB] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: true, place: null })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)

			const result = await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			expect(geocoder).toHaveBeenCalledTimes(2)
			expect(result.geocoded).toBe(0)
			expect(result.geocodeNoPlace).toBe(2)
		})

		it('never logs coords, place, or response data on any path', async () => {
			const mediaStore = makeMediaStore()
			const fileidStore = makeFileidStore()
			const folderStore = makeFolderStore()
			setupGpsImage()
			const client = fakeClient({ files: [jpegA] })
			const geocoder = vi.fn<Geocoder>().mockResolvedValue({ ok: true, place: 'Madrid, España' })
			const sleep = vi.fn<Sleeper>().mockResolvedValue(undefined)
			const log = vi.spyOn(console, 'log').mockImplementation(() => {})
			const info = vi.spyOn(console, 'info').mockImplementation(() => {})
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
			const error = vi.spyOn(console, 'error').mockImplementation(() => {})

			await refreshMemories(
				client,
				42,
				createMediaCache(mediaStore),
				createFileidIndex(fileidStore),
				createFolderCache(folderStore),
				{ apiKey: APIKEY, geocoder, sleep },
			)

			const sensitive = ['40.4', '-3.7', 'Madrid', 'España']
			for (const spy of [log, info, warn, error]) {
				for (const call of spy.mock.calls) {
					const flat = call.map((a: unknown) => String(a)).join(' ')
					for (const needle of sensitive) {
						expect(flat).not.toContain(needle)
					}
				}
			}
			log.mockRestore()
			info.mockRestore()
			warn.mockRestore()
			error.mockRestore()
		})
	})
})
