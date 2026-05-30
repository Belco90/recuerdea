import type { Client, FileMetadata } from 'pcloud-kit'

import type { CollectionCache } from '../cache/collection-cache'
import type { FileidIndex } from '../cache/fileid-index'
import type { CachedMedia, MediaCache } from '../cache/media-cache'

import { buildThumbUrl } from '../memories/pcloud-urls.server'

export type CollectionItem = {
	uuid: string
	fileid: number
	name: string
	kind: 'image' | 'video' | 'other'
	thumbUrl: string | null
}

function kindFromCached(meta: CachedMedia): 'image' | 'video' | 'other' {
	if (meta.kind === 'image') return 'image'
	if (meta.kind === 'video') return 'video'
	return 'other'
}

function assertUuids(uuids: readonly string[]): void {
	if (uuids.length === 0) throw new TypeError('uuids must not be empty')
	for (const u of uuids) {
		if (typeof u !== 'string' || u.length === 0) {
			throw new TypeError(`uuids must be non-empty strings (got ${String(u)})`)
		}
	}
}

function assertFileids(fileids: readonly number[]): void {
	if (fileids.length === 0) throw new TypeError('fileids must not be empty')
	for (const f of fileids) {
		if (!Number.isInteger(f) || f <= 0) {
			throw new TypeError(`fileids must be positive integers (got ${String(f)})`)
		}
	}
}

function parseCapturedDate(iso: string): string | null {
	const ms = Date.parse(iso)
	return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

export async function fetchCuratedItems(
	collection: CollectionCache,
	media: MediaCache,
): Promise<CollectionItem[]> {
	const snap = await collection.lookup()
	if (!snap || snap.uuids.length === 0) return []

	const metas = await Promise.all(snap.uuids.map((uuid) => media.lookup(uuid)))
	const items: CollectionItem[] = []
	for (let i = 0; i < snap.uuids.length; i++) {
		const uuid = snap.uuids[i]!
		const meta = metas[i]
		if (!meta) continue
		items.push({
			uuid,
			fileid: meta.fileid,
			name: meta.name,
			kind: kindFromCached(meta),
			thumbUrl: buildThumbUrl(meta.code, '320x320'),
		})
	}
	return items
}

type StatResponse = { metadata: FileMetadata }
type PublinkResponse = { code: string; linkid: number }

// Server-side helper: given a pCloud fileid, return the uuid for it.
// If the fileid is already indexed, return the existing uuid without
// hitting pCloud. Otherwise call `stat` + `getfilepublink`, mint a uuid,
// and write `media/<uuid>` + `fileid-index/<fileid>`. No range-fetch
// extraction — width/height/location/place stay null and the cron's
// geocode pass picks the entry up later (when applicable).
export async function lazyMintFile(
	client: Client,
	fileidIndex: FileidIndex,
	mediaCache: MediaCache,
	fileid: number,
): Promise<string> {
	const existing = await fileidIndex.lookup(fileid)
	if (existing) return existing

	const stat = await client.call<StatResponse>('stat', { fileid })
	const meta = stat.metadata
	const publink = await client.call<PublinkResponse>('getfilepublink', { fileid })

	const uuid = crypto.randomUUID()
	const cached: CachedMedia = {
		fileid,
		hash: meta.hash,
		code: publink.code,
		linkid: publink.linkid,
		kind: meta.contenttype.startsWith('video/') ? 'video' : 'image',
		contenttype: meta.contenttype,
		name: meta.name,
		captureDate: parseCapturedDate(meta.created),
		width: null,
		height: null,
		location: null,
		place: null,
	}
	await mediaCache.remember(uuid, cached)
	await fileidIndex.remember(fileid, uuid)
	return uuid
}

export async function addFileidsToCollection(
	client: Client,
	fileidIndex: FileidIndex,
	mediaCache: MediaCache,
	collection: CollectionCache,
	fileids: readonly number[],
): Promise<void> {
	assertFileids(fileids)
	const uuids: string[] = []
	for (const fileid of fileids) {
		// eslint-disable-next-line no-await-in-loop
		const uuid = await lazyMintFile(client, fileidIndex, mediaCache, fileid)
		uuids.push(uuid)
	}
	const current = (await collection.lookup())?.uuids ?? []
	const merged = [...current]
	const seen = new Set(current)
	for (const uuid of uuids) {
		if (!seen.has(uuid)) {
			merged.push(uuid)
			seen.add(uuid)
		}
	}
	await collection.remember({ refreshedAt: new Date().toISOString(), uuids: merged })
}

export async function removeUuidsFromCollection(
	collection: CollectionCache,
	uuids: readonly string[],
): Promise<void> {
	assertUuids(uuids)
	const current = (await collection.lookup())?.uuids ?? []
	const drop = new Set(uuids)
	const next = current.filter((u) => !drop.has(u))
	await collection.remember({ refreshedAt: new Date().toISOString(), uuids: next })
}
