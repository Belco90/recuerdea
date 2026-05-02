import type { Client } from 'pcloud-kit'

import type { CachedMedia } from '../cache/media-cache'

import { createFolderCache } from '../cache/folder-cache'
import { getFolderCacheStore } from '../cache/folder-cache.server'
import { createMediaCache } from '../cache/media-cache'
import { getMediaCacheStore } from '../cache/media-cache.server'
import { resolveMediaUrl, resolveThumbUrl } from './pcloud-urls.server'

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

async function buildOrDrop(client: Client, match: Match): Promise<MemoryItem | null> {
	try {
		const captureDate = match.capture.toISOString()
		if (match.meta.kind === 'video') {
			const [thumbUrl, lightboxUrl, mediaUrl] = await Promise.all([
				resolveThumbUrl(client, match.meta.code, '640x640'),
				resolveThumbUrl(client, match.meta.code, '1025x1025'),
				resolveMediaUrl(client, match.meta.code),
			])
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
				mediaUrl,
			}
		}
		const [thumbUrl, lightboxUrl] = await Promise.all([
			resolveThumbUrl(client, match.meta.code, '640x640'),
			resolveThumbUrl(client, match.meta.code, '1025x1025'),
		])
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
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown error'
		// eslint-disable-next-line no-console
		console.warn(`[pcloud] dropping memory: ${message}`)
		return null
	}
}

export async function fetchTodayMemories(
	today: { month: number; day: number },
	client: Client,
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

	// Oldest year first; tiebreak by fileid asc. Deterministic per (folder, day).
	matches.sort(
		(a, b) => a.capture.getFullYear() - b.capture.getFullYear() || a.meta.fileid - b.meta.fileid,
	)

	if (matches.length === 0) return []

	const items = await Promise.all(matches.map((match) => buildOrDrop(client, match)))
	return items.filter((m): m is MemoryItem => m !== null)
}
