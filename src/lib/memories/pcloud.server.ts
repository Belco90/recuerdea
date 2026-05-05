import type { CachedMedia } from '../cache/media-cache'

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

export type ResolveVideoUrlByCode = (code: string) => Promise<string>

function tryParseDate(iso: string | null): Date | null {
	if (!iso) return null
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? null : d
}

function buildImageItem(match: Match): MemoryItem {
	return {
		kind: 'image',
		uuid: match.uuid,
		name: match.meta.name,
		captureDate: match.capture.toISOString(),
		width: match.meta.width,
		height: match.meta.height,
		place: match.meta.place,
		thumbUrl: buildThumbUrl(match.meta.code, '640x640'),
		lightboxUrl: buildThumbUrl(match.meta.code, '1025x1025'),
	}
}

function buildVideoItem(match: Match, mediaUrl: string): MemoryItem {
	return {
		kind: 'video',
		uuid: match.uuid,
		contenttype: match.meta.contenttype,
		name: match.meta.name,
		captureDate: match.capture.toISOString(),
		width: match.meta.width,
		height: match.meta.height,
		place: match.meta.place,
		thumbUrl: buildThumbUrl(match.meta.code, '640x640'),
		lightboxUrl: buildThumbUrl(match.meta.code, '1025x1025'),
		mediaUrl,
	}
}

export async function fetchTodayMemories(
	today: { month: number; day: number },
	deps: { resolveVideoUrl: ResolveVideoUrlByCode },
): Promise<MemoryItem[]> {
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

	// Newest year first; tiebreak by fileid asc. Deterministic per (folder, day).
	matches.sort(
		(a, b) => b.capture.getFullYear() - a.capture.getFullYear() || a.meta.fileid - b.meta.fileid,
	)

	// Resolve video play URLs in parallel via getpubvideolinks. A failure drops
	// only the offending video with a single warn (no fileid / no code in log).
	const items = await Promise.all(
		matches.map(async (match): Promise<MemoryItem | null> => {
			if (match.meta.kind === 'image') return buildImageItem(match)
			try {
				const mediaUrl = await deps.resolveVideoUrl(match.meta.code)
				return buildVideoItem(match, mediaUrl)
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn(
					'[pcloud] failed to resolve video URL — dropping item:',
					err instanceof Error ? err.message : err,
				)
				return null
			}
		}),
	)
	return items.filter((m): m is MemoryItem => m !== null)
}
