import type { Client, FileMetadata } from 'pcloud-kit'

export type AdminFileItem = {
	fileid: number
	name: string
	kind: 'image' | 'video' | 'other'
	thumbUrl: string | null
}

export class CollectionIdMissingError extends Error {
	readonly tag = 'collection-id-missing' as const
	constructor() {
		super('PCLOUD_COLLECTION_ID is not set')
	}
}

export function assertCollectionId(): number {
	const raw = process.env.PCLOUD_COLLECTION_ID
	if (!raw) throw new CollectionIdMissingError()
	const id = Number(raw)
	if (!Number.isInteger(id)) throw new TypeError('PCLOUD_COLLECTION_ID must be an integer')
	return id
}

// pCloud's `collection_details` with `showfiles=1` returns the file array under
// `collection.contents`. `collection.items` is the COUNT (a number), not an
// array — easy to confuse, and an empty collection comes back with `items: 0`.
type CollectionDetailsResponse = {
	collection: {
		contents?: ReadonlyArray<FileMetadata>
		items?: number | ReadonlyArray<FileMetadata>
	}
}

type ThumbsLinksResponse = {
	thumbs: ReadonlyArray<{
		result: number
		fileid: number
		path?: string
		hosts?: ReadonlyArray<string>
	}>
}

function kindFromContenttype(ct: string): 'image' | 'video' | 'other' {
	if (ct.startsWith('image/')) return 'image'
	if (ct.startsWith('video/')) return 'video'
	return 'other'
}

function assertPositiveIntegers(fileids: readonly number[]): void {
	if (fileids.length === 0) throw new TypeError('fileids must not be empty')
	for (const id of fileids) {
		if (!Number.isInteger(id) || id <= 0) {
			throw new TypeError(`fileids must be positive integers (got ${id})`)
		}
	}
}

export async function fetchCollectionMedia(client: Client): Promise<AdminFileItem[]> {
	const collectionid = assertCollectionId()
	const res = await client.call<CollectionDetailsResponse>('collection_details', {
		collectionid,
		showfiles: 1,
	})
	const files =
		res.collection.contents ?? (Array.isArray(res.collection.items) ? res.collection.items : [])
	if (files.length === 0) return []

	const fileids = files.map((f) => f.fileid)
	const thumbs = await client.call<ThumbsLinksResponse>('getthumbslinks', {
		fileids: fileids.join(','),
		size: '320x320',
		crop: 1,
		type: 'jpg',
	})
	const thumbByFileid = new Map<number, string>()
	for (const t of thumbs.thumbs) {
		if (t.result !== 0) continue
		const host = t.hosts?.[0]
		if (!host || !t.path) continue
		thumbByFileid.set(t.fileid, `https://${host}${t.path}`)
	}

	return files.map((f) => ({
		fileid: f.fileid,
		name: f.name,
		kind: kindFromContenttype(f.contenttype),
		thumbUrl: thumbByFileid.get(f.fileid) ?? null,
	}))
}

export async function linkFilesToCollectionRaw(
	client: Client,
	fileids: readonly number[],
): Promise<void> {
	assertPositiveIntegers(fileids)
	const collectionid = assertCollectionId()
	await client.call('collection_linkfiles', {
		collectionid,
		fileids: fileids.join(','),
	})
}

export async function unlinkFilesFromCollectionRaw(
	client: Client,
	fileids: readonly number[],
): Promise<void> {
	assertPositiveIntegers(fileids)
	const collectionid = assertCollectionId()
	await client.call('collection_unlinkfiles', {
		collectionid,
		fileids: fileids.join(','),
	})
}
