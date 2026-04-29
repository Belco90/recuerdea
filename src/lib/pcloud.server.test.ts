import type { Client, FileMetadata, FolderMetadata } from 'pcloud-kit'

import { createClient } from 'pcloud-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CaptureCacheStore, CaptureCacheValue } from './capture-cache'

import { getCaptureCacheStore } from './capture-cache.server'
import { extractCaptureDate } from './exif'
import { fetchTodayMemories } from './pcloud.server'
import { extractVideoCaptureDate } from './video-meta'

vi.mock('pcloud-kit')
vi.mock('./exif')
vi.mock('./video-meta')
vi.mock('./capture-cache.server')

const mockedCreateClient = vi.mocked(createClient)
const mockedExtractCaptureDate = vi.mocked(extractCaptureDate)
const mockedExtractVideoCaptureDate = vi.mocked(extractVideoCaptureDate)
const mockedGetCaptureCacheStore = vi.mocked(getCaptureCacheStore)

function makeFakeStore() {
	const data = new Map<number, CaptureCacheValue>()
	const get = vi.fn<CaptureCacheStore['get']>(async (fileid) => data.get(fileid))
	const set = vi.fn<CaptureCacheStore['set']>(async (fileid, value) => {
		data.set(fileid, value)
	})
	return { get, set, data } satisfies CaptureCacheStore & { data: typeof data }
}

let fakeStore: ReturnType<typeof makeFakeStore>

function makeFile(
	overrides: Partial<FileMetadata> & Pick<FileMetadata, 'fileid' | 'name' | 'contenttype'>,
): FileMetadata {
	return {
		parentfolderid: 0,
		isfolder: false,
		size: 0,
		hash: '',
		category: 0,
		id: '',
		isshared: false,
		icon: '',
		created: '',
		modified: '',
		...overrides,
	}
}

function makeFolder(
	overrides: Partial<FolderMetadata> & Pick<FolderMetadata, 'folderid' | 'name'>,
): FolderMetadata {
	return {
		isfolder: true,
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
	return makeFolder({ folderid: 0, name: 'root', contents })
}

function fakeClient(overrides: Partial<Client> = {}): Client {
	return {
		listfolder: vi.fn<Client['listfolder']>(),
		getfilelink: vi
			.fn<Client['getfilelink']>()
			.mockImplementation(async (id: number) => `https://download/${id}`),
		call: vi.fn<Client['call']>().mockImplementation(async (method: string) => {
			throw new Error(`unexpected pCloud method in tests: ${method}`)
		}) as unknown as Client['call'],
		...overrides,
	} as unknown as Client
}

const jpegA = makeFile({ fileid: 100, name: 'a.jpg', contenttype: 'image/jpeg' })
const jpegB = makeFile({ fileid: 200, name: 'b.jpg', contenttype: 'image/jpeg' })
const mp4C = makeFile({ fileid: 300, name: 'c.mp4', contenttype: 'video/mp4' })
const movD = makeFile({ fileid: 400, name: 'd.mov', contenttype: 'video/quicktime' })
const pdfE = makeFile({ fileid: 500, name: 'e.pdf', contenttype: 'application/pdf' })

beforeEach(() => {
	process.env.PCLOUD_TOKEN = 'test-token'
	process.env.PCLOUD_MEMORIES_FOLDER_ID = '42'
	fakeStore = makeFakeStore()
	mockedGetCaptureCacheStore.mockReturnValue(fakeStore)
})

afterEach(() => {
	process.env.PCLOUD_TOKEN = ''
	process.env.PCLOUD_MEMORIES_FOLDER_ID = ''
})

describe('fetchTodayMemories', () => {
	it('returns image and video items in oldest-year-first order', async () => {
		const client = fakeClient({
			listfolder: vi
				.fn<Client['listfolder']>()
				.mockResolvedValue(
					makeFolderResult([makeFolder({ folderid: 1, name: 'sub' }), pdfE, jpegA, mp4C, jpegB]),
				),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockImplementation(async (url: string) => {
			if (url.endsWith('/100')) return new Date('2024-04-27T14:30:00Z') // jpegA: matches, year 2024
			if (url.endsWith('/200')) return new Date('2024-06-15T09:00:00Z') // jpegB: wrong day
			return null
		})
		mockedExtractVideoCaptureDate.mockImplementation(async (url: string) => {
			if (url.endsWith('/300')) return new Date('2018-04-27T10:00:00Z') // mp4C: matches, year 2018
			return null
		})

		const result = await fetchTodayMemories({ month: 4, day: 27 })

		expect(result).toEqual([
			{
				kind: 'video',
				fileid: 300,
				contenttype: 'video/mp4',
				name: 'c.mp4',
				captureDate: '2018-04-27T10:00:00.000Z',
			},
			{
				kind: 'image',
				fileid: 100,
				name: 'a.jpg',
				captureDate: '2024-04-27T14:30:00.000Z',
			},
		])
	})

	it('builds an image MemoryItem carrying the fileid', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([jpegA])),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockResolvedValue(new Date('2019-04-27T14:30:00Z'))

		const [item] = await fetchTodayMemories({ month: 4, day: 27 })

		expect(item).toEqual({
			kind: 'image',
			fileid: 100,
			name: 'a.jpg',
			captureDate: '2019-04-27T14:30:00.000Z',
		})
		// URL signing happens in the browser — the loader never calls getthumblink.
		expect(client.call).not.toHaveBeenCalledWith('getthumblink', expect.anything())
		expect(mockedExtractVideoCaptureDate).not.toHaveBeenCalled()
	})

	it('builds a video MemoryItem carrying the fileid and contenttype', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([mp4C])),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractVideoCaptureDate.mockResolvedValue(new Date('2020-04-27T10:00:00Z'))

		const [item] = await fetchTodayMemories({ month: 4, day: 27 })

		expect(item).toEqual({
			kind: 'video',
			fileid: 300,
			contenttype: 'video/mp4',
			name: 'c.mp4',
			captureDate: '2020-04-27T10:00:00.000Z',
		})
		// `client.getfilelink(300)` is still called by safeExtractCaptureDate to
		// fetch the byte range for mvhd parsing — that URL is consumed in-handler
		// and never leaked into the MemoryItem.
		expect(client.call).not.toHaveBeenCalledWith('getthumblink', expect.anything())
		expect(mockedExtractCaptureDate).not.toHaveBeenCalled()
	})

	it('handles MOV (video/quicktime) the same as MP4', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([movD])),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractVideoCaptureDate.mockResolvedValue(new Date('2021-04-27T10:00:00Z'))

		const [item] = await fetchTodayMemories({ month: 4, day: 27 })

		expect(item?.kind).toBe('video')
		expect(item?.name).toBe('d.mov')
	})

	it('breaks ties by fileid ascending when years match', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([jpegB, jpegA])), // unsorted
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockResolvedValue(new Date('2020-04-27T10:00:00Z'))

		const result = await fetchTodayMemories({ month: 4, day: 27 })
		expect(result.map((m) => m.name)).toEqual(['a.jpg', 'b.jpg'])
	})

	it('skips items without a parseable capture date', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([jpegA, jpegB])),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockImplementation(async (url: string) => {
			if (url.endsWith('/100')) return null
			return new Date('2019-04-27T10:00:00Z')
		})

		const result = await fetchTodayMemories({ month: 4, day: 27 })
		expect(result).toHaveLength(1)
		expect(result[0]?.name).toBe('b.jpg')
	})

	it('skips items whose capture date does not match today', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([jpegA])),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockResolvedValue(new Date('2020-12-31T00:00:00Z'))

		const result = await fetchTodayMemories({ month: 4, day: 27 })
		expect(result).toEqual([])
	})

	it('returns an empty array when the folder has no media files', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([pdfE])),
		})
		mockedCreateClient.mockReturnValue(client)

		const result = await fetchTodayMemories({ month: 4, day: 27 })
		expect(result).toEqual([])
		expect(mockedExtractCaptureDate).not.toHaveBeenCalled()
		expect(mockedExtractVideoCaptureDate).not.toHaveBeenCalled()
	})

	it('returns an empty array when the folder has no contents', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult(undefined)),
		})
		mockedCreateClient.mockReturnValue(client)

		await expect(fetchTodayMemories({ month: 4, day: 27 })).resolves.toEqual([])
	})

	it('skips an image when extractCaptureDate throws', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([jpegA, jpegB])),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockImplementation(async (url: string) => {
			if (url.endsWith('/100')) throw new Error('network down')
			return new Date('2020-04-27T10:00:00Z')
		})

		const result = await fetchTodayMemories({ month: 4, day: 27 })
		expect(result.map((m) => m.name)).toEqual(['b.jpg'])
	})

	it('skips a video when extractVideoCaptureDate throws', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([mp4C, jpegA])),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractVideoCaptureDate.mockRejectedValue(new Error('network down'))
		mockedExtractCaptureDate.mockResolvedValue(new Date('2020-04-27T10:00:00Z'))

		const result = await fetchTodayMemories({ month: 4, day: 27 })
		expect(result.map((m) => m.name)).toEqual(['a.jpg'])
	})

	it('falls back to filename date when EXIF returns null (e.g. HEIC)', async () => {
		const heic = makeFile({
			fileid: 600,
			name: '2026-04-27 17-16-08.heic',
			contenttype: 'image/heic',
		})
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([heic])),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockResolvedValue(null)

		const result = await fetchTodayMemories({ month: 4, day: 27 })

		expect(result).toHaveLength(1)
		expect(result[0]).toMatchObject({
			kind: 'image',
			name: '2026-04-27 17-16-08.heic',
		})
		// Day-precision check, timezone-agnostic.
		const captureDate = new Date(result[0]?.captureDate ?? '')
		expect(captureDate.getFullYear()).toBe(2026)
		expect(captureDate.getMonth()).toBe(3)
		expect(captureDate.getDate()).toBe(27)
	})

	it('drops a file when both EXIF and filename parsing fail', async () => {
		const opaqueHeic = makeFile({
			fileid: 700,
			name: 'IMG_4567.HEIC',
			contenttype: 'image/heic',
		})
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([opaqueHeic])),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockResolvedValue(null)

		const result = await fetchTodayMemories({ month: 4, day: 27 })
		expect(result).toEqual([])
	})

	it('throws when PCLOUD_TOKEN is missing', async () => {
		process.env.PCLOUD_TOKEN = ''
		await expect(fetchTodayMemories({ month: 4, day: 27 })).rejects.toThrow(
			'PCLOUD_TOKEN is not set',
		)
		expect(mockedCreateClient).not.toHaveBeenCalled()
	})

	it('throws when PCLOUD_MEMORIES_FOLDER_ID is missing', async () => {
		process.env.PCLOUD_MEMORIES_FOLDER_ID = ''
		await expect(fetchTodayMemories({ month: 4, day: 27 })).rejects.toThrow(
			'PCLOUD_MEMORIES_FOLDER_ID is not set',
		)
	})

	it('throws when PCLOUD_MEMORIES_FOLDER_ID is not an integer', async () => {
		process.env.PCLOUD_MEMORIES_FOLDER_ID = 'not-a-number'
		await expect(fetchTodayMemories({ month: 4, day: 27 })).rejects.toThrow(
			'PCLOUD_MEMORIES_FOLDER_ID must be an integer',
		)
	})

	describe('capture-date cache', () => {
		it('hits cache and skips getfilelink + extractor when fileid+hash match', async () => {
			const file = makeFile({
				fileid: 100,
				name: 'a.jpg',
				contenttype: 'image/jpeg',
				hash: 'abc',
			})
			fakeStore.data.set(100, { hash: 'abc', captureDate: '2020-04-27T10:00:00.000Z' })
			const client = fakeClient({
				listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([file])),
			})
			mockedCreateClient.mockReturnValue(client)

			const result = await fetchTodayMemories({ month: 4, day: 27 })

			expect(result).toHaveLength(1)
			expect(result[0]?.name).toBe('a.jpg')
			expect(client.getfilelink).not.toHaveBeenCalled()
			expect(mockedExtractCaptureDate).not.toHaveBeenCalled()
			expect(mockedExtractVideoCaptureDate).not.toHaveBeenCalled()
			expect(fakeStore.set).not.toHaveBeenCalled()
		})

		it('runs extractor on miss and writes the result back', async () => {
			const file = makeFile({
				fileid: 100,
				name: 'a.jpg',
				contenttype: 'image/jpeg',
				hash: 'abc',
			})
			const client = fakeClient({
				listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([file])),
			})
			mockedCreateClient.mockReturnValue(client)
			mockedExtractCaptureDate.mockResolvedValue(new Date('2020-04-27T10:00:00.000Z'))

			await fetchTodayMemories({ month: 4, day: 27 })

			expect(mockedExtractCaptureDate).toHaveBeenCalledTimes(1)
			expect(fakeStore.set).toHaveBeenCalledWith(100, {
				hash: 'abc',
				captureDate: '2020-04-27T10:00:00.000Z',
			})
		})

		it('treats hash mismatch as miss and overwrites the stale entry', async () => {
			const file = makeFile({
				fileid: 100,
				name: 'a.jpg',
				contenttype: 'image/jpeg',
				hash: 'new-hash',
			})
			fakeStore.data.set(100, { hash: 'old-hash', captureDate: '2018-01-01T00:00:00.000Z' })
			const client = fakeClient({
				listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([file])),
			})
			mockedCreateClient.mockReturnValue(client)
			mockedExtractCaptureDate.mockResolvedValue(new Date('2021-04-27T10:00:00.000Z'))

			await fetchTodayMemories({ month: 4, day: 27 })

			expect(mockedExtractCaptureDate).toHaveBeenCalledTimes(1)
			expect(fakeStore.set).toHaveBeenCalledWith(100, {
				hash: 'new-hash',
				captureDate: '2021-04-27T10:00:00.000Z',
			})
		})

		it('caches a negative result so undated files are not re-extracted', async () => {
			const file = makeFile({
				fileid: 700,
				name: 'IMG_4567.HEIC',
				contenttype: 'image/heic',
				hash: 'abc',
			})
			const client = fakeClient({
				listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([file])),
			})
			mockedCreateClient.mockReturnValue(client)
			mockedExtractCaptureDate.mockResolvedValue(null)

			await fetchTodayMemories({ month: 4, day: 27 })

			expect(fakeStore.set).toHaveBeenCalledWith(700, { hash: 'abc', captureDate: null })
		})
	})
})
