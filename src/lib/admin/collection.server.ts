import type { Client, FileMetadata } from 'pcloud-kit'

import type { FileidIndex } from '../cache/fileid-index'
import type { MediaCache } from '../cache/media-cache'
import type { AdminMediaItem } from './folder-media.server'

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

function buildThumb(code: string): string {
	return `https://eapi.pcloud.com/getpubthumb?code=${encodeURIComponent(code)}&size=320x320`
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

export async function fetchCollectionMedia(
	client: Client,
	fileidIndex: FileidIndex,
	mediaCache: MediaCache,
): Promise<AdminMediaItem[]> {
	const collectionid = assertCollectionId()
	const res = await client.call<CollectionDetailsResponse>('collection_details', {
		collectionid,
		showfiles: 1,
	})
	const files =
		res.collection.contents ?? (Array.isArray(res.collection.items) ? res.collection.items : [])

	const items = await Promise.all(
		files.map(async (file): Promise<AdminMediaItem | null> => {
			const uuid = await fileidIndex.lookup(file.fileid)
			if (!uuid) return null
			const meta = await mediaCache.lookup(uuid)
			if (!meta) return null
			return {
				uuid,
				kind: meta.kind,
				name: meta.name,
				captureDate: meta.captureDate,
				fileid: meta.fileid,
				thumbUrl: buildThumb(meta.code),
			}
		}),
	)
	return items.filter((m): m is AdminMediaItem => m !== null)
}

async function resolveFileids(
	uuids: readonly string[],
	mediaCache: MediaCache,
): Promise<readonly number[]> {
	if (uuids.length === 0) throw new TypeError('uuids must not be empty')
	const lookups = await Promise.all(
		uuids.map(async (uuid) => {
			const meta = await mediaCache.lookup(uuid)
			if (!meta) throw new Error(`media-cache missing uuid: ${uuid}`)
			return meta.fileid
		}),
	)
	return lookups
}

export async function linkFilesToCollectionRaw(
	client: Client,
	mediaCache: MediaCache,
	uuids: readonly string[],
): Promise<void> {
	const collectionid = assertCollectionId()
	const fileids = await resolveFileids(uuids, mediaCache)
	await client.call('collection_linkfiles', {
		collectionid,
		fileids: fileids.join(','),
	})
}

export async function unlinkFilesFromCollectionRaw(
	client: Client,
	mediaCache: MediaCache,
	uuids: readonly string[],
): Promise<void> {
	const collectionid = assertCollectionId()
	const fileids = await resolveFileids(uuids, mediaCache)
	await client.call('collection_unlinkfiles', {
		collectionid,
		fileids: fileids.join(','),
	})
}
