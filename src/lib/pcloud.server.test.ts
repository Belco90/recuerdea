import { type Client, type FileMetadata, type FolderMetadata, createClient } from 'pcloud-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractCaptureDate } from './exif'
import { fetchRandomMemoryImage, fetchTodayMemoryImage } from './pcloud.server'

vi.mock('pcloud-kit')
vi.mock('./exif')

const mockedCreateClient = vi.mocked(createClient)
const mockedExtractCaptureDate = vi.mocked(extractCaptureDate)

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
		call: vi.fn<Client['call']>() as unknown as Client['call'],
		getfilelink: vi.fn<Client['getfilelink']>(),
		...overrides,
	} as unknown as Client
}

const thumbResponse = {
	hosts: ['api.pcloud.com'],
	path: '/abc/img.jpg',
}

const jpegA = makeFile({ fileid: 100, name: 'a.jpg', contenttype: 'image/jpeg' })
const jpegB = makeFile({ fileid: 200, name: 'b.jpg', contenttype: 'image/jpeg' })
const jpegC = makeFile({ fileid: 300, name: 'c.jpg', contenttype: 'image/jpeg' })

beforeEach(() => {
	process.env.PCLOUD_TOKEN = 'test-token'
	process.env.PCLOUD_MEMORIES_FOLDER_ID = '42'
})

afterEach(() => {
	process.env.PCLOUD_TOKEN = ''
	process.env.PCLOUD_MEMORIES_FOLDER_ID = ''
	vi.clearAllMocks()
})

describe('fetchTodayMemoryImage', () => {
	it('returns the image whose EXIF capture matches today, skipping non-matches and missing EXIF', async () => {
		const client = fakeClient({
			listfolder: vi
				.fn<Client['listfolder']>()
				.mockResolvedValue(
					makeFolderResult([
						makeFolder({ folderid: 1, name: 'sub' }),
						makeFile({ fileid: 50, name: 'doc.pdf', contenttype: 'application/pdf' }),
						jpegA,
						jpegB,
						jpegC,
					]),
				),
			getfilelink: vi
				.fn<Client['getfilelink']>()
				.mockImplementation(async (id: number) => `https://download/${id}`),
			call: vi.fn<Client['call']>().mockResolvedValue(thumbResponse) as unknown as Client['call'],
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockImplementation(async (url: string) => {
			if (url.endsWith('/100')) return null // jpegA: no EXIF
			if (url.endsWith('/200')) return new Date('2019-04-27T14:30:00Z') // jpegB: matches
			if (url.endsWith('/300')) return new Date('2020-06-15T09:00:00Z') // jpegC: wrong day
			return null
		})

		await expect(fetchTodayMemoryImage({ month: 4, day: 27 })).resolves.toEqual({
			url: 'https://api.pcloud.com/abc/img.jpg',
			name: 'b.jpg',
			captureDate: '2019-04-27T14:30:00.000Z',
		})
		expect(client.call).toHaveBeenCalledWith('getthumblink', { fileid: 200, size: '2048x1024' })
	})

	it('returns null when no image matches today', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([jpegA])),
			getfilelink: vi.fn<Client['getfilelink']>().mockResolvedValue('https://download/100'),
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockResolvedValue(new Date('2020-12-31T00:00:00Z'))

		await expect(fetchTodayMemoryImage({ month: 4, day: 27 })).resolves.toBeNull()
		expect(client.call).not.toHaveBeenCalled()
	})

	it('returns null when the folder has no images', async () => {
		const client = fakeClient({
			listfolder: vi
				.fn<Client['listfolder']>()
				.mockResolvedValue(
					makeFolderResult([
						makeFile({ fileid: 1, name: 'a.pdf', contenttype: 'application/pdf' }),
					]),
				),
		})
		mockedCreateClient.mockReturnValue(client)

		await expect(fetchTodayMemoryImage({ month: 4, day: 27 })).resolves.toBeNull()
		expect(mockedExtractCaptureDate).not.toHaveBeenCalled()
	})

	it('returns null when the folder is empty (no contents)', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult(undefined)),
		})
		mockedCreateClient.mockReturnValue(client)

		await expect(fetchTodayMemoryImage({ month: 4, day: 27 })).resolves.toBeNull()
	})

	it('picks the oldest year when multiple images match', async () => {
		const client = fakeClient({
			listfolder: vi
				.fn<Client['listfolder']>()
				.mockResolvedValue(makeFolderResult([jpegA, jpegB, jpegC])),
			getfilelink: vi
				.fn<Client['getfilelink']>()
				.mockImplementation(async (id: number) => `https://download/${id}`),
			call: vi.fn<Client['call']>().mockResolvedValue(thumbResponse) as unknown as Client['call'],
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockImplementation(async (url: string) => {
			if (url.endsWith('/100')) return new Date('2024-04-27T10:00:00Z') // newest
			if (url.endsWith('/200')) return new Date('2018-04-27T10:00:00Z') // OLDEST → winner
			if (url.endsWith('/300')) return new Date('2021-04-27T10:00:00Z')
			return null
		})

		const result = await fetchTodayMemoryImage({ month: 4, day: 27 })
		expect(result?.name).toBe('b.jpg')
		expect(result?.captureDate).toBe('2018-04-27T10:00:00.000Z')
	})

	it('breaks ties by fileid ascending when years match', async () => {
		const client = fakeClient({
			listfolder: vi
				.fn<Client['listfolder']>()
				.mockResolvedValue(makeFolderResult([jpegC, jpegA, jpegB])), // unsorted on purpose
			getfilelink: vi
				.fn<Client['getfilelink']>()
				.mockImplementation(async (id: number) => `https://download/${id}`),
			call: vi.fn<Client['call']>().mockResolvedValue(thumbResponse) as unknown as Client['call'],
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockResolvedValue(new Date('2020-04-27T10:00:00Z'))

		const result = await fetchTodayMemoryImage({ month: 4, day: 27 })
		// jpegA has the lowest fileid (100) → wins the tiebreak
		expect(result?.name).toBe('a.jpg')
	})

	it('skips images where extractCaptureDate throws (continues to next)', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([jpegA, jpegB])),
			getfilelink: vi
				.fn<Client['getfilelink']>()
				.mockImplementation(async (id: number) => `https://download/${id}`),
			call: vi.fn<Client['call']>().mockResolvedValue(thumbResponse) as unknown as Client['call'],
		})
		mockedCreateClient.mockReturnValue(client)
		mockedExtractCaptureDate.mockImplementation(async (url: string) => {
			if (url.endsWith('/100')) throw new Error('network down')
			return new Date('2019-04-27T10:00:00Z')
		})

		const result = await fetchTodayMemoryImage({ month: 4, day: 27 })
		expect(result?.name).toBe('b.jpg')
	})

	it('throws when PCLOUD_TOKEN is missing', async () => {
		process.env.PCLOUD_TOKEN = ''
		await expect(fetchTodayMemoryImage({ month: 4, day: 27 })).rejects.toThrow(
			'PCLOUD_TOKEN is not set',
		)
		expect(mockedCreateClient).not.toHaveBeenCalled()
	})

	it('throws when PCLOUD_MEMORIES_FOLDER_ID is missing', async () => {
		process.env.PCLOUD_MEMORIES_FOLDER_ID = ''
		await expect(fetchTodayMemoryImage({ month: 4, day: 27 })).rejects.toThrow(
			'PCLOUD_MEMORIES_FOLDER_ID is not set',
		)
		expect(mockedCreateClient).not.toHaveBeenCalled()
	})

	it('throws when PCLOUD_MEMORIES_FOLDER_ID is not an integer', async () => {
		process.env.PCLOUD_MEMORIES_FOLDER_ID = 'not-a-number'
		await expect(fetchTodayMemoryImage({ month: 4, day: 27 })).rejects.toThrow(
			'PCLOUD_MEMORIES_FOLDER_ID must be an integer',
		)
	})
})

describe('fetchRandomMemoryImage', () => {
	it('returns a random image with captureDate null', async () => {
		const client = fakeClient({
			listfolder: vi
				.fn<Client['listfolder']>()
				.mockResolvedValue(makeFolderResult([jpegA, jpegB, jpegC])),
			call: vi.fn<Client['call']>().mockResolvedValue(thumbResponse) as unknown as Client['call'],
		})
		mockedCreateClient.mockReturnValue(client)
		// 0.5 * 3 = 1.5 → floor → index 1 → jpegB
		vi.spyOn(Math, 'random').mockReturnValue(0.5)

		await expect(fetchRandomMemoryImage()).resolves.toEqual({
			url: 'https://api.pcloud.com/abc/img.jpg',
			name: 'b.jpg',
			captureDate: null,
		})
		expect(client.call).toHaveBeenCalledWith('getthumblink', { fileid: 200, size: '2048x1024' })
		expect(mockedExtractCaptureDate).not.toHaveBeenCalled()
	})

	it('returns null when the folder is empty', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult([])),
		})
		mockedCreateClient.mockReturnValue(client)

		await expect(fetchRandomMemoryImage()).resolves.toBeNull()
		expect(client.call).not.toHaveBeenCalled()
	})

	it('throws when PCLOUD_TOKEN is missing', async () => {
		process.env.PCLOUD_TOKEN = ''
		await expect(fetchRandomMemoryImage()).rejects.toThrow('PCLOUD_TOKEN is not set')
	})
})
