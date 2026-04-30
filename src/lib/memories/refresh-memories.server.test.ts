import type { Client, FileMetadata, FolderMetadata } from 'pcloud-kit'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileidIndexStore } from '../cache/fileid-index'
import type { FolderCacheStore, FolderSnapshot } from '../cache/folder-cache'
import type { CachedMedia, MediaCacheStore } from '../cache/media-cache'

import { createFileidIndex } from '../cache/fileid-index'
import { createFolderCache } from '../cache/folder-cache'
import { createMediaCache } from '../cache/media-cache'
import { extractImageMeta } from '../media-meta/exif'
import { extractVideoMeta } from '../media-meta/video-meta'
import { refreshMemories } from './refresh-memories.server'

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

		expect(result).toEqual({ scanned: 1, alive: 1, removed: 0 })
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

		expect(result).toEqual({ scanned: 1, alive: 1, removed: 1 })
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
})
