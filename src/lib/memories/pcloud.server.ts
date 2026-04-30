import type { CachedMedia } from '../cache/media-cache'

import { createFolderCache } from '../cache/folder-cache'
import { getFolderCacheStore } from '../cache/folder-cache.server'
import { createMediaCache } from '../cache/media-cache'
import { getMediaCacheStore } from '../cache/media-cache.server'

export type MemoryItem =
	| {
			kind: 'image'
			uuid: string
			name: string
			captureDate: string
			width: number | null
			height: number | null
	  }
	| {
			kind: 'video'
			uuid: string
			contenttype: string
			name: string
			captureDate: string
			width: number | null
			height: number | null
	  }

type Match = { uuid: string; meta: CachedMedia; capture: Date }

function tryParseDate(iso: string | null): Date | null {
	if (!iso) return null
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? null : d
}

function buildMemoryItem({ uuid, meta, capture }: Match): MemoryItem {
	const captureDate = capture.toISOString()
	if (meta.kind === 'video') {
		return {
			kind: 'video',
			uuid,
			contenttype: meta.contenttype,
			name: meta.name,
			captureDate,
			width: meta.width,
			height: meta.height,
		}
	}
	return {
		kind: 'image',
		uuid,
		name: meta.name,
		captureDate,
		width: meta.width,
		height: meta.height,
	}
}

export async function fetchTodayMemories(today: {
	month: number
	day: number
}): Promise<MemoryItem[]> {
	// Cache-only: zero pCloud API calls when warm. The cron is the sole writer.
	const folderCache = createFolderCache(getFolderCacheStore())
	const mediaCache = createMediaCache(getMediaCacheStore())

	const snapshot = await folderCache.lookup()
	if (!snapshot) {
		// eslint-disable-next-line no-console
		console.warn('[pcloud] folder snapshot missing — cron has not run yet')
		return []
	}

	const lookups = await Promise.all(
		snapshot.uuids.map(async (uuid): Promise<Match | null> => {
			const meta = await mediaCache.lookup(uuid)
			if (!meta) return null
			const capture = tryParseDate(meta.captureDate)
			if (!capture) return null
			const matched = capture.getMonth() + 1 === today.month && capture.getDate() === today.day
			return matched ? { uuid, meta, capture } : null
		}),
	)
	const matches = lookups.filter((m): m is Match => m !== null)

	// Oldest year first; tiebreak by fileid asc. Deterministic per (folder, day).
	matches.sort(
		(a, b) => a.capture.getFullYear() - b.capture.getFullYear() || a.meta.fileid - b.meta.fileid,
	)

	return matches.map(buildMemoryItem)
}
