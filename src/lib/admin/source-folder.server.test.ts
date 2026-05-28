import type { Client, FileMetadata, FolderMetadata } from 'pcloud-kit'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	FolderNotPermittedError,
	SourceFolderIdMissingError,
	assertSourceFolderId,
	fetchAdminSourceFolder,
} from './source-folder.server'

const ROOT_ID = 1000

function makeClient(impl: (method: string, params: unknown) => Promise<unknown>): Client {
	return {
		call: vi.fn<(method: string, params: unknown) => Promise<unknown>>(
			impl,
		) as unknown as Client['call'],
	} as unknown as Client
}

function makeFolder(folderid: number, overrides: Partial<FolderMetadata> = {}): FolderMetadata {
	return {
		folderid,
		parentfolderid: ROOT_ID,
		name: `Folder ${folderid}`,
		isfolder: true,
		id: `f-${folderid}`,
		isshared: false,
		icon: '',
		created: '',
		modified: '',
		...overrides,
	}
}

function makeFile(fileid: number, overrides: Partial<FileMetadata> = {}): FileMetadata {
	return {
		fileid,
		parentfolderid: ROOT_ID,
		name: `f-${fileid}.jpg`,
		isfolder: false,
		size: 0,
		contenttype: 'image/jpeg',
		hash: `h-${fileid}`,
		category: 0,
		id: `i-${fileid}`,
		isshared: false,
		icon: '',
		created: '',
		modified: '',
		...overrides,
	}
}

beforeEach(() => {
	vi.stubEnv('PCLOUD_SOURCE_FOLDER_ID', String(ROOT_ID))
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.clearAllMocks()
})

describe('assertSourceFolderId', () => {
	it('returns the parsed integer when env var is set', () => {
		vi.stubEnv('PCLOUD_SOURCE_FOLDER_ID', '42')
		expect(assertSourceFolderId()).toBe(42)
	})

	it('throws SourceFolderIdMissingError when env var is unset', () => {
		vi.stubEnv('PCLOUD_SOURCE_FOLDER_ID', '')
		expect(() => assertSourceFolderId()).toThrow(SourceFolderIdMissingError)
	})

	it('throws TypeError when env var is not an integer', () => {
		vi.stubEnv('PCLOUD_SOURCE_FOLDER_ID', 'abc')
		expect(() => assertSourceFolderId()).toThrow(TypeError)
	})
})

describe('fetchAdminSourceFolder', () => {
	it('defaults to the source root when no folderid is passed', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const client = makeClient(async (method, params) => {
			calls.push({ method, params })
			if (method === 'listfolder') {
				return {
					metadata: makeFolder(ROOT_ID, {
						name: 'root',
						parentfolderid: 0,
						contents: [],
					}),
				}
			}
			throw new Error(`unexpected method: ${method}`)
		})

		const result = await fetchAdminSourceFolder(client)

		expect(calls[0]).toEqual({
			method: 'listfolder',
			params: { folderid: ROOT_ID, noshares: 1 },
		})
		expect(result.folderid).toBe(ROOT_ID)
		expect(result.breadcrumbs).toEqual([{ folderid: ROOT_ID, name: 'Raíz' }])
		expect(result.subfolders).toEqual([])
		expect(result.files).toEqual([])
	})

	it('splits contents into subfolders and image/video files', async () => {
		const client = makeClient(async (method) => {
			if (method === 'listfolder') {
				return {
					metadata: makeFolder(ROOT_ID, {
						name: 'root',
						parentfolderid: 0,
						contents: [
							makeFolder(11, { name: 'Sub A' }),
							makeFolder(12, { name: 'Sub B' }),
							makeFile(100, { contenttype: 'image/jpeg', name: 'photo.jpg' }),
							makeFile(200, { contenttype: 'video/mp4', name: 'clip.mp4' }),
							makeFile(300, { contenttype: 'application/pdf', name: 'doc.pdf' }),
						],
					}),
				}
			}
			throw new Error(`unexpected method: ${method}`)
		})

		const result = await fetchAdminSourceFolder(client)

		expect(result.subfolders).toEqual([
			{ folderid: 11, name: 'Sub A' },
			{ folderid: 12, name: 'Sub B' },
		])
		expect(result.files).toEqual([
			{
				fileid: 100,
				name: 'photo.jpg',
				kind: 'image',
				thumbUrl: '/api/admin/thumb/100',
			},
			{
				fileid: 200,
				name: 'clip.mp4',
				kind: 'video',
				thumbUrl: '/api/admin/thumb/200',
			},
		])
	})

	it('only calls listfolder — thumbnails resolve through the proxy route', async () => {
		const methodsSeen: string[] = []
		const client = makeClient(async (method) => {
			methodsSeen.push(method)
			if (method === 'listfolder') {
				return {
					metadata: makeFolder(ROOT_ID, {
						parentfolderid: 0,
						contents: [
							makeFile(100, { contenttype: 'image/jpeg' }),
							makeFile(200, { contenttype: 'image/jpeg' }),
						],
					}),
				}
			}
			throw new Error(`unexpected method: ${method}`)
		})

		await fetchAdminSourceFolder(client)

		expect(new Set(methodsSeen)).toEqual(new Set(['listfolder']))
	})

	it('builds breadcrumbs by walking up to the source root', async () => {
		const folders = new Map<number, FolderMetadata>([
			[ROOT_ID, makeFolder(ROOT_ID, { name: 'root', parentfolderid: 0 })],
			[11, makeFolder(11, { name: 'Año 2024', parentfolderid: ROOT_ID })],
			[22, makeFolder(22, { name: 'Mayo', parentfolderid: 11 })],
			[33, makeFolder(33, { name: 'Viaje', parentfolderid: 22 })],
		])
		const client = makeClient(async (method, params) => {
			if (method === 'listfolder') {
				const p = params as { folderid: number }
				const meta = folders.get(p.folderid)
				if (!meta) throw new Error(`folder not found: ${p.folderid}`)
				return { metadata: meta }
			}
			throw new Error(`unexpected method: ${method}`)
		})

		const result = await fetchAdminSourceFolder(client, { folderid: 33 })

		expect(result.folderid).toBe(33)
		expect(result.name).toBe('Viaje')
		expect(result.breadcrumbs).toEqual([
			{ folderid: ROOT_ID, name: 'Raíz' },
			{ folderid: 11, name: 'Año 2024' },
			{ folderid: 22, name: 'Mayo' },
			{ folderid: 33, name: 'Viaje' },
		])
	})

	it('throws FolderNotPermittedError when the target is not under the source root', async () => {
		const folders = new Map<number, FolderMetadata>([
			[8888, makeFolder(8888, { name: 'Other', parentfolderid: 9999 })],
			[9999, makeFolder(9999, { name: 'Outside', parentfolderid: 0 })],
		])
		const client = makeClient(async (method, params) => {
			if (method === 'listfolder') {
				const p = params as { folderid: number }
				const meta = folders.get(p.folderid)
				if (!meta) throw new Error(`folder not found: ${p.folderid}`)
				return { metadata: meta }
			}
			throw new Error(`unexpected method: ${method}`)
		})

		await expect(fetchAdminSourceFolder(client, { folderid: 8888 })).rejects.toThrow(
			FolderNotPermittedError,
		)
	})

	it('caps the breadcrumb walk at depth 10', async () => {
		const folders = new Map<number, FolderMetadata>()
		for (let i = 0; i <= 11; i++) {
			folders.set(i, makeFolder(i, { name: `f${i}`, parentfolderid: i === 0 ? undefined : i - 1 }))
		}
		const client = makeClient(async (method, params) => {
			if (method === 'listfolder') {
				const p = params as { folderid: number }
				const meta = folders.get(p.folderid)
				if (!meta) throw new Error(`folder not found: ${p.folderid}`)
				return { metadata: meta }
			}
			throw new Error(`unexpected method: ${method}`)
		})

		await expect(fetchAdminSourceFolder(client, { folderid: 11 })).rejects.toThrow(
			FolderNotPermittedError,
		)
	})

	it('throws SourceFolderIdMissingError when env var is unset', async () => {
		vi.stubEnv('PCLOUD_SOURCE_FOLDER_ID', '')
		const client = makeClient(async () => ({ metadata: makeFolder(ROOT_ID) }))

		await expect(fetchAdminSourceFolder(client)).rejects.toThrow(SourceFolderIdMissingError)
	})

	it('scales to large folders without per-file pCloud calls', async () => {
		const fileCount = 250
		const files = Array.from({ length: fileCount }, (_, i) =>
			makeFile(1000 + i, { contenttype: 'image/jpeg' }),
		)
		const methodsSeen: string[] = []
		const client = makeClient(async (method) => {
			methodsSeen.push(method)
			if (method === 'listfolder') {
				return { metadata: makeFolder(ROOT_ID, { parentfolderid: 0, contents: files }) }
			}
			throw new Error(`unexpected method: ${method}`)
		})

		const result = await fetchAdminSourceFolder(client)

		expect(result.files).toHaveLength(fileCount)
		expect(result.files[0]).toEqual({
			fileid: 1000,
			name: 'f-1000.jpg',
			kind: 'image',
			thumbUrl: '/api/admin/thumb/1000',
		})
		// One listfolder call for the target; no per-file API calls.
		expect(methodsSeen).toEqual(['listfolder'])
	})
})
