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

function thumbEntry(fileid: number, path = `/p-${fileid}`) {
	return {
		result: 0,
		fileid,
		path,
		hosts: ['eapi-cdn.pcloud.com'],
		size: '320x320',
		expires: 'Wed, 28 May 2026 00:00:00 +0000',
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
			if (method === 'getthumbslinks') {
				return { thumbs: [thumbEntry(100), thumbEntry(200)] }
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
				thumbUrl: 'https://eapi-cdn.pcloud.com/p-100',
			},
			{
				fileid: 200,
				name: 'clip.mp4',
				kind: 'video',
				thumbUrl: 'https://eapi-cdn.pcloud.com/p-200',
			},
		])
	})

	it('batches getthumbslinks once with the full CSV', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const client = makeClient(async (method, params) => {
			calls.push({ method, params })
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
			return { thumbs: [thumbEntry(100), thumbEntry(200)] }
		})

		await fetchAdminSourceFolder(client)

		const thumbCalls = calls.filter((c) => c.method === 'getthumbslinks')
		expect(thumbCalls).toHaveLength(1)
		expect(thumbCalls[0]?.params).toEqual({
			fileids: '100,200',
			size: '320x320',
			crop: 1,
			type: 'jpg',
		})
	})

	it('skips getthumbslinks when the folder has no media', async () => {
		const calls: string[] = []
		const client = makeClient(async (method) => {
			calls.push(method)
			if (method === 'listfolder') {
				return {
					metadata: makeFolder(ROOT_ID, {
						parentfolderid: 0,
						contents: [makeFolder(11)],
					}),
				}
			}
			throw new Error(`unexpected method: ${method}`)
		})

		await fetchAdminSourceFolder(client)

		expect(calls).toEqual(['listfolder'])
	})

	it('builds breadcrumbs by walking up to the source root', async () => {
		// Tree: ROOT (1000) → 11 → 22 → 33 (target)
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
		// Tree: 9999 → 8888 (target). Neither is under ROOT_ID.
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
		// Build a chain 0→1→2→...→11 where ROOT_ID is never reached.
		// Walking up from folder 11 should bail after 10 steps with FolderNotPermittedError.
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

	it('returns thumbUrl=null when a file is missing from the thumbs response', async () => {
		const client = makeClient(async (method) => {
			if (method === 'listfolder') {
				return {
					metadata: makeFolder(ROOT_ID, {
						parentfolderid: 0,
						contents: [makeFile(100), makeFile(200)],
					}),
				}
			}
			return { thumbs: [thumbEntry(100)] }
		})

		const result = await fetchAdminSourceFolder(client)

		expect(result.files.map((f) => ({ fileid: f.fileid, thumbUrl: f.thumbUrl }))).toEqual([
			{ fileid: 100, thumbUrl: 'https://eapi-cdn.pcloud.com/p-100' },
			{ fileid: 200, thumbUrl: null },
		])
	})
})
