import type { Client } from 'pcloud-kit'

import type { CachedMedia } from '../cache/media-cache'

import { createFolderCache } from '../cache/folder-cache'
import { getFolderCacheStore } from '../cache/folder-cache.server'
import { createMediaCache } from '../cache/media-cache'
import { getMediaCacheStore } from '../cache/media-cache.server'
import { buildThumbUrl, resolveMediaUrl } from './pcloud-urls.server'

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
	const captureDate = match.capture.toISOString()
	const thumbUrl = buildThumbUrl(match.meta.code, '640x640')
	const lightboxUrl = buildThumbUrl(match.meta.code, '1025x1025')

	if (match.meta.kind === 'video') {
		try {
			const mediaUrl = await resolveMediaUrl(client, match.meta.code)
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
		} catch (err) {
			const message = err instanceof Error ? err.message : 'unknown error'
			// eslint-disable-next-line no-console
			console.warn(`[pcloud] dropping video memory: ${message}`)
			return null
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

	// Newest year first; tiebreak by fileid asc. Deterministic per (folder, day).
	matches.sort(
		(a, b) => b.capture.getFullYear() - a.capture.getFullYear() || a.meta.fileid - b.meta.fileid,
	)

	if (matches.length === 0) return []

	const items = await Promise.all(matches.map((match) => buildOrDrop(client, match)))
	return items.filter((m): m is MemoryItem => m !== null)
}
