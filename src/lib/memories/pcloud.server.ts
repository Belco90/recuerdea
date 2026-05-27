import type { CachedMedia } from '../cache/media-cache'

import { createCollectionCache } from '../cache/collection-cache'
import { getCollectionCacheStore } from '../cache/collection-cache.server'
import { createFolderCache } from '../cache/folder-cache'
import { getFolderCacheStore } from '../cache/folder-cache.server'
import { createMediaCache } from '../cache/media-cache'
import { getMediaCacheStore } from '../cache/media-cache.server'
import { buildThumbUrl } from './pcloud-urls.server'

export type MemoryItem =
	| {
			kind: 'image'
			uuid: string
			name: string
			captureDate: string
			width: number | null
			height: number | null
			place: string | null
			thumbUrl: string
			lightboxUrl: string
	  }
	| {
			kind: 'video'
			uuid: string
			contenttype: string
			name: string
			captureDate: string
			width: number | null
			height: number | null
			place: string | null
			thumbUrl: string
			lightboxUrl: string
			mediaUrl: string
	  }

type Match = { uuid: string; meta: CachedMedia; capture: Date }

function tryParseDate(iso: string | null): Date | null {
	if (!iso) return null
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? null : d
}

function buildMemoryItem(match: Match): MemoryItem {
	const captureDate = match.capture.toISOString()
	const thumbUrl = buildThumbUrl(match.meta.code, '640x640')
	const lightboxUrl = buildThumbUrl(match.meta.code, '1025x1025')

	if (match.meta.kind === 'video') {
		return {
			kind: 'video',
			uuid: match.uuid,
			contenttype: match.meta.contenttype,
			name: match.meta.name,
			captureDate,
			width: match.meta.width,
			height: match.meta.height,
			place: match.meta.place,
			thumbUrl,
			lightboxUrl,
			// Auth-gated proxy: pCloud's signed CDN URLs (`getpubvideolinks`,
			// `getpublinkdownload`) are IP-bound — direct browser fetches get a
			// 410 "another IP address". The proxy resolves upstream server-side
			// and pipes bytes back. See video-stream.server.ts.
			mediaUrl: `/api/video/${match.uuid}`,
		}
	}
	return {
		kind: 'image',
		uuid: match.uuid,
		name: match.meta.name,
		captureDate,
		width: match.meta.width,
		height: match.meta.height,
		place: match.meta.place,
		thumbUrl,
		lightboxUrl,
	}
}

export async function fetchTodayMemories(today: {
	month: number
	day: number
}): Promise<MemoryItem[]> {
	const collectionCache = createCollectionCache(getCollectionCacheStore())
	const folderCache = createFolderCache(getFolderCacheStore())
	const mediaCache = createMediaCache(getMediaCacheStore())

	// Curated collection wins when it exists (even when empty — an empty
	// collection means "show nothing", not "fall back"). Folder snapshot is
	// the boot/rollback fallback: before the first Phase-4 cron run, or when
	// `PCLOUD_COLLECTION_ID` is unset.
	const collectionSnap = await collectionCache.lookup()
	const uuids = collectionSnap?.uuids
	if (!uuids) {
		const folderSnap = await folderCache.lookup()
		if (!folderSnap) {
			// eslint-disable-next-line no-console
			console.warn('[pcloud] folder snapshot missing — cron has not run yet')
			return []
		}
		return matchAndBuild(folderSnap.uuids, mediaCache, today)
	}

	return matchAndBuild(uuids, mediaCache, today)
}

async function matchAndBuild(
	uuids: readonly string[],
	mediaCache: ReturnType<typeof createMediaCache>,
	today: { month: number; day: number },
): Promise<MemoryItem[]> {
	const lookups = await Promise.all(
		uuids.map(async (uuid): Promise<Match | null> => {
			const meta = await mediaCache.lookup(uuid)
			if (!meta) return null
			const capture = tryParseDate(meta.captureDate)
			if (!capture) return null
			const matched = capture.getMonth() + 1 === today.month && capture.getDate() === today.day
			return matched ? { uuid, meta, capture } : null
		}),
	)
	const matches = lookups.filter((m): m is Match => m !== null)

	// Newest year first; tiebreak by fileid asc. Deterministic per (folder, day).
	matches.sort(
		(a, b) => b.capture.getFullYear() - a.capture.getFullYear() || a.meta.fileid - b.meta.fileid,
	)

	return matches.map(buildMemoryItem)
}
