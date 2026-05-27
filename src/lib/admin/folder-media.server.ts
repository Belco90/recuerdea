import type { CachedMedia } from '../cache/media-cache'

import { createFolderCache } from '../cache/folder-cache'
import { getFolderCacheStore } from '../cache/folder-cache.server'
import { createMediaCache } from '../cache/media-cache'
import { getMediaCacheStore } from '../cache/media-cache.server'

export type AdminMediaItem = {
	uuid: string
	kind: 'image' | 'video'
	name: string
	captureDate: string | null
	fileid: number
	thumbUrl: string
}

type Entry = { uuid: string; meta: CachedMedia }

function buildThumb(code: string): string {
	return `https://eapi.pcloud.com/getpubthumb?code=${encodeURIComponent(code)}&size=320x320`
}

function toItem({ uuid, meta }: Entry): AdminMediaItem {
	return {
		uuid,
		kind: meta.kind,
		name: meta.name,
		captureDate: meta.captureDate,
		fileid: meta.fileid,
		thumbUrl: buildThumb(meta.code),
	}
}

// Sort newest captureDate first; nulls last; fileid asc tiebreak (deterministic
// across refreshes so the admin grid does not reshuffle between visits).
function compare(a: Entry, b: Entry): number {
	const aTs = a.meta.captureDate ? Date.parse(a.meta.captureDate) : NaN
	const bTs = b.meta.captureDate ? Date.parse(b.meta.captureDate) : NaN
	const aHas = Number.isFinite(aTs)
	const bHas = Number.isFinite(bTs)
	if (aHas && bHas && aTs !== bTs) return bTs - aTs
	if (aHas !== bHas) return aHas ? -1 : 1
	return a.meta.fileid - b.meta.fileid
}

export async function fetchAdminFolderMedia(): Promise<AdminMediaItem[]> {
	const folderCache = createFolderCache(getFolderCacheStore())
	const mediaCache = createMediaCache(getMediaCacheStore())

	const snapshot = await folderCache.lookup()
	if (!snapshot) return []

	const entries = await Promise.all(
		snapshot.uuids.map(async (uuid): Promise<Entry | null> => {
			const meta = await mediaCache.lookup(uuid)
			return meta ? { uuid, meta } : null
		}),
	)
	const live: Entry[] = entries.filter((e): e is Entry => e !== null)
	live.sort(compare)
	return live.map(toItem)
}
