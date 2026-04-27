import { type Client, type FileMetadata, type FolderMetadata, createClient } from 'pcloud-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchFirstMemoryImage } from './pcloud.server'

vi.mock('pcloud-kit')

const mockedCreateClient = vi.mocked(createClient)

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

// vi.fn<Client['call']>() returns Mock<…Promise<unknown>>, which doesn't satisfy
// the generic Client['call'] signature (Promise<T>) — cast through unknown at use sites.
function fakeClient(overrides: Partial<Client> = {}): Client {
	return {
		listfolder: vi.fn<Client['listfolder']>(),
		call: vi.fn<Client['call']>() as unknown as Client['call'],
		...overrides,
	} as unknown as Client
}

describe('fetchFirstMemoryImage', () => {
	beforeEach(() => {
		process.env.PCLOUD_TOKEN = 'test-token'
		process.env.PCLOUD_MEMORIES_FOLDER_ID = '42'
	})

	afterEach(() => {
		process.env.PCLOUD_TOKEN = ''
		process.env.PCLOUD_MEMORIES_FOLDER_ID = ''
	})

	it('returns the first image, skipping subfolders and non-image files', async () => {
		const client = fakeClient({
			listfolder: vi
				.fn<Client['listfolder']>()
				.mockResolvedValue(
					makeFolderResult([
						makeFolder({ folderid: 1, name: 'sub' }),
						makeFile({ fileid: 2, name: 'a.pdf', contenttype: 'application/pdf' }),
						makeFile({ fileid: 3, name: 'b.jpg', contenttype: 'image/jpeg' }),
						makeFile({ fileid: 4, name: 'c.png', contenttype: 'image/png' }),
					]),
				),
			call: vi.fn<Client['call']>().mockResolvedValue({
				hosts: ['api.pcloud.com'],
				path: '/abc/b.jpg',
			}) as unknown as Client['call'],
		})
		mockedCreateClient.mockReturnValue(client)

		await expect(fetchFirstMemoryImage()).resolves.toEqual({
			url: 'https://api.pcloud.com/abc/b.jpg',
			name: 'b.jpg',
		})
		expect(mockedCreateClient).toHaveBeenCalledWith({ token: 'test-token', type: 'pcloud' })
		expect(client.listfolder).toHaveBeenCalledWith(42)
		expect(client.call).toHaveBeenCalledWith('getthumblink', { fileid: 3, size: '2048x1024' })
	})

	it('returns null when the folder has no images', async () => {
		const client = fakeClient({
			listfolder: vi
				.fn<Client['listfolder']>()
				.mockResolvedValue(
					makeFolderResult([
						makeFolder({ folderid: 1, name: 'sub' }),
						makeFile({ fileid: 2, name: 'a.pdf', contenttype: 'application/pdf' }),
					]),
				),
		})
		mockedCreateClient.mockReturnValue(client)

		await expect(fetchFirstMemoryImage()).resolves.toBeNull()
		expect(client.call).not.toHaveBeenCalled()
	})

	it('returns null when the folder is empty (no contents)', async () => {
		const client = fakeClient({
			listfolder: vi.fn<Client['listfolder']>().mockResolvedValue(makeFolderResult(undefined)),
		})
		mockedCreateClient.mockReturnValue(client)

		await expect(fetchFirstMemoryImage()).resolves.toBeNull()
		expect(client.call).not.toHaveBeenCalled()
	})

	it('throws when PCLOUD_TOKEN is missing', async () => {
		process.env.PCLOUD_TOKEN = ''
		await expect(fetchFirstMemoryImage()).rejects.toThrow('PCLOUD_TOKEN is not set')
		expect(mockedCreateClient).not.toHaveBeenCalled()
	})

	it('throws when PCLOUD_MEMORIES_FOLDER_ID is missing', async () => {
		process.env.PCLOUD_MEMORIES_FOLDER_ID = ''
		await expect(fetchFirstMemoryImage()).rejects.toThrow('PCLOUD_MEMORIES_FOLDER_ID is not set')
		expect(mockedCreateClient).not.toHaveBeenCalled()
	})

	it('throws when PCLOUD_MEMORIES_FOLDER_ID is not an integer', async () => {
		process.env.PCLOUD_MEMORIES_FOLDER_ID = 'not-a-number'
		await expect(fetchFirstMemoryImage()).rejects.toThrow(
			'PCLOUD_MEMORIES_FOLDER_ID must be an integer',
		)
		expect(mockedCreateClient).not.toHaveBeenCalled()
	})
})
