import type { CollectionCache } from '../cache/collection-cache'
import type { CachedMedia, MediaCache } from '../cache/media-cache'

import { buildThumbUrl } from '../memories/pcloud-urls.server'

export type AdminFileItem = {
	uuid: string
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

export async function fetchCuratedItems(
	collection: CollectionCache,
	media: MediaCache,
): Promise<AdminFileItem[]> {
	const snap = await collection.lookup()
	if (!snap || snap.uuids.length === 0) return []

	const metas = await Promise.all(snap.uuids.map((uuid) => media.lookup(uuid)))
	const items: AdminFileItem[] = []
	for (let i = 0; i < snap.uuids.length; i++) {
		const uuid = snap.uuids[i]!
		const meta = metas[i]
		if (!meta) continue
		items.push({
			uuid,
			name: meta.name,
			kind: kindFromCached(meta),
			thumbUrl: buildThumbUrl(meta.code, '320x320'),
		})
	}
	return items
}

export async function addUuidsToCollection(
	collection: CollectionCache,
	uuids: readonly string[],
): Promise<void> {
	assertUuids(uuids)
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
