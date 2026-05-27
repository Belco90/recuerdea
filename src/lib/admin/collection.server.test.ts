import type { Client, FileMetadata } from 'pcloud-kit'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	CollectionIdMissingError,
	assertCollectionId,
	fetchCollectionMedia,
	linkFilesToCollectionRaw,
	unlinkFilesFromCollectionRaw,
} from './collection.server'

function makeClient(impl: (method: string, params: unknown) => Promise<unknown>): Client {
	return {
		call: vi.fn<(method: string, params: unknown) => Promise<unknown>>(
			impl,
		) as unknown as Client['call'],
	} as unknown as Client
}

function makeFile(fileid: number, overrides: Partial<FileMetadata> = {}): FileMetadata {
	return {
		fileid,
		parentfolderid: 0,
		name: `f-${fileid}.jpg`,
		isfolder: false,
		size: 0,
		contenttype: 'image/jpeg',
		hash: `h-${fileid}`,
		category: 0,
		id: '',
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
	vi.stubEnv('PCLOUD_COLLECTION_ID', '99')
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.clearAllMocks()
})

describe('assertCollectionId', () => {
	it('returns the parsed integer when env var is set', () => {
		vi.stubEnv('PCLOUD_COLLECTION_ID', '42')
		expect(assertCollectionId()).toBe(42)
	})

	it('throws CollectionIdMissingError when env var is unset', () => {
		vi.stubEnv('PCLOUD_COLLECTION_ID', '')
		expect(() => assertCollectionId()).toThrow(CollectionIdMissingError)
	})

	it('throws TypeError when env var is not an integer', () => {
		vi.stubEnv('PCLOUD_COLLECTION_ID', 'abc')
		expect(() => assertCollectionId()).toThrow(TypeError)
	})
})

describe('fetchCollectionMedia', () => {
	it('maps collection_details + getthumbslinks into AdminFileItem[]', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const client = makeClient(async (method, params) => {
			calls.push({ method, params })
			if (method === 'collection_details') {
				return {
					collection: {
						items: 2,
						contents: [
							makeFile(100, { name: 'a.jpg', contenttype: 'image/jpeg' }),
							makeFile(200, { name: 'b.mp4', contenttype: 'video/mp4' }),
						],
					},
				}
			}
			if (method === 'getthumbslinks') {
				return { thumbs: [thumbEntry(100, '/abc'), thumbEntry(200, '/def')] }
			}
			throw new Error(`unexpected method: ${method}`)
		})

		const result = await fetchCollectionMedia(client)

		expect(calls[0]).toEqual({
			method: 'collection_details',
			params: { collectionid: 99, showfiles: 1 },
		})
		expect(calls[1]).toEqual({
			method: 'getthumbslinks',
			params: { fileids: '100,200', size: '320x320', crop: 1, type: 'jpg' },
		})
		expect(result).toEqual([
			{ fileid: 100, name: 'a.jpg', kind: 'image', thumbUrl: 'https://eapi-cdn.pcloud.com/abc' },
			{ fileid: 200, name: 'b.mp4', kind: 'video', thumbUrl: 'https://eapi-cdn.pcloud.com/def' },
		])
	})

	it('marks non-image/video files as kind="other"', async () => {
		const client = makeClient(async (method) => {
			if (method === 'collection_details') {
				return {
					collection: {
						items: 1,
						contents: [makeFile(100, { name: 'doc.pdf', contenttype: 'application/pdf' })],
					},
				}
			}
			return { thumbs: [thumbEntry(100)] }
		})

		const result = await fetchCollectionMedia(client)

		expect(result[0]?.kind).toBe('other')
	})

	it('returns thumbUrl=null when a file is missing from the thumbs response', async () => {
		const client = makeClient(async (method) => {
			if (method === 'collection_details') {
				return {
					collection: {
						items: 2,
						contents: [makeFile(100), makeFile(200)],
					},
				}
			}
			return { thumbs: [thumbEntry(100)] }
		})

		const result = await fetchCollectionMedia(client)

		expect(result.map((m) => ({ fileid: m.fileid, thumbUrl: m.thumbUrl }))).toEqual([
			{ fileid: 100, thumbUrl: 'https://eapi-cdn.pcloud.com/p-100' },
			{ fileid: 200, thumbUrl: null },
		])
	})

	it('returns thumbUrl=null when an entry has result != 0', async () => {
		const client = makeClient(async (method) => {
			if (method === 'collection_details') {
				return {
					collection: { items: 1, contents: [makeFile(100)] },
				}
			}
			return { thumbs: [{ ...thumbEntry(100), result: 2009 }] }
		})

		const result = await fetchCollectionMedia(client)

		expect(result[0]?.thumbUrl).toBeNull()
	})

	it('returns [] for an empty collection without calling getthumbslinks', async () => {
		const calls: string[] = []
		const client = makeClient(async (method) => {
			calls.push(method)
			if (method === 'collection_details') return { collection: { items: 0 } }
			throw new Error(`unexpected method: ${method}`)
		})

		const result = await fetchCollectionMedia(client)

		expect(result).toEqual([])
		expect(calls).toEqual(['collection_details'])
	})

	it('handles the `collection.contents` field being absent', async () => {
		const client = makeClient(async (method) => {
			if (method === 'collection_details') return { collection: {} }
			throw new Error(`unexpected method: ${method}`)
		})

		expect(await fetchCollectionMedia(client)).toEqual([])
	})

	it('throws CollectionIdMissingError when PCLOUD_COLLECTION_ID is unset', async () => {
		vi.stubEnv('PCLOUD_COLLECTION_ID', '')
		const client = makeClient(async () => ({ collection: { items: 0 } }))

		await expect(fetchCollectionMedia(client)).rejects.toThrow(CollectionIdMissingError)
	})
})

describe('linkFilesToCollectionRaw', () => {
	it('calls collection_linkfiles with a CSV of fileids', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const client = makeClient(async (method, params) => {
			calls.push({ method, params })
			return { result: 0 }
		})

		await linkFilesToCollectionRaw(client, [100, 200])

		expect(calls).toEqual([
			{
				method: 'collection_linkfiles',
				params: { collectionid: 99, fileids: '100,200' },
			},
		])
	})

	it('throws TypeError when fileids is empty', async () => {
		const client = makeClient(async () => ({ result: 0 }))
		await expect(linkFilesToCollectionRaw(client, [])).rejects.toThrow(TypeError)
	})

	it('throws TypeError when fileids contains a non-integer', async () => {
		const client = makeClient(async () => ({ result: 0 }))
		await expect(linkFilesToCollectionRaw(client, [1.5])).rejects.toThrow(TypeError)
	})

	it('throws TypeError when fileids contains a non-positive integer', async () => {
		const client = makeClient(async () => ({ result: 0 }))
		await expect(linkFilesToCollectionRaw(client, [0])).rejects.toThrow(TypeError)
		await expect(linkFilesToCollectionRaw(client, [-1])).rejects.toThrow(TypeError)
	})

	it('throws CollectionIdMissingError when env var is unset', async () => {
		vi.stubEnv('PCLOUD_COLLECTION_ID', '')
		const client = makeClient(async () => ({ result: 0 }))

		await expect(linkFilesToCollectionRaw(client, [100])).rejects.toThrow(CollectionIdMissingError)
	})
})

describe('unlinkFilesFromCollectionRaw', () => {
	it('calls collection_unlinkfiles with a CSV of fileids', async () => {
		const calls: Array<{ method: string; params: unknown }> = []
		const client = makeClient(async (method, params) => {
			calls.push({ method, params })
			return { result: 0 }
		})

		await unlinkFilesFromCollectionRaw(client, [100])

		expect(calls).toEqual([
			{
				method: 'collection_unlinkfiles',
				params: { collectionid: 99, fileids: '100' },
			},
		])
	})

	it('throws TypeError when fileids is empty', async () => {
		const client = makeClient(async () => ({ result: 0 }))
		await expect(unlinkFilesFromCollectionRaw(client, [])).rejects.toThrow(TypeError)
	})

	it('throws TypeError when fileids contains a non-integer', async () => {
		const client = makeClient(async () => ({ result: 0 }))
		await expect(unlinkFilesFromCollectionRaw(client, [1.5])).rejects.toThrow(TypeError)
	})
})
