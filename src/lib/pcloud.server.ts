import type { Client, FileMetadata, FolderMetadata } from 'pcloud-kit'

import { createClient } from 'pcloud-kit'

import type { CaptureCache } from './capture-cache'

import { createCaptureCache } from './capture-cache'
import { getCaptureCacheStore } from './capture-cache.server'
import { extractCaptureDate } from './exif'
import { parseFilenameCaptureDate } from './filename-date'
import { extractVideoCaptureDate } from './video-meta'

export type MemoryItem =
	| { kind: 'image'; fileid: number; name: string; captureDate: string }
	| {
			kind: 'video'
			fileid: number
			contenttype: string
			name: string
			captureDate: string
	  }

function getEnvConfig(): { token: string; folderId: number } {
	const token = process.env.PCLOUD_TOKEN
	const folderIdRaw = process.env.PCLOUD_MEMORIES_FOLDER_ID
	if (!token) throw new Error('PCLOUD_TOKEN is not set')
	if (!folderIdRaw) throw new Error('PCLOUD_MEMORIES_FOLDER_ID is not set')

	const folderId = Number(folderIdRaw)
	if (!Number.isInteger(folderId)) {
		throw new Error('PCLOUD_MEMORIES_FOLDER_ID must be an integer')
	}
	return { token, folderId }
}

function isMediaFile(item: FileMetadata | FolderMetadata): item is FileMetadata {
	if (item.isfolder) return false
	const ct = item.contenttype
	return ct.startsWith('image/') || ct.startsWith('video/')
}

function isVideo(file: FileMetadata): boolean {
	return file.contenttype.startsWith('video/')
}

async function listMediaFiles(client: Client, folderId: number): Promise<FileMetadata[]> {
	const folder = await client.listfolder(folderId)
	return folder.contents?.filter(isMediaFile) ?? []
}

async function safeExtractCaptureDate(
	client: Client,
	file: FileMetadata,
	cache: CaptureCache,
): Promise<Date | null> {
	const cached = await cache.lookup(file.fileid, file.hash)
	if (cached !== undefined) return cached

	let result: Date | null = null
	try {
		const downloadUrl = await client.getfilelink(file.fileid)
		const exifCapture = isVideo(file)
			? await extractVideoCaptureDate(downloadUrl)
			: await extractCaptureDate(downloadUrl)
		result = exifCapture ?? parseFilenameCaptureDate(file.name) ?? null
	} catch {
		result = null
	}
	await cache.remember(file.fileid, file.hash, result)
	return result
}

function buildMemoryItem(file: FileMetadata, capture: Date): MemoryItem {
	const captureDate = capture.toISOString()
	if (isVideo(file)) {
		return {
			kind: 'video',
			fileid: file.fileid,
			contenttype: file.contenttype,
			name: file.name,
			captureDate,
		}
	}
	return {
		kind: 'image',
		fileid: file.fileid,
		name: file.name,
		captureDate,
	}
}

export async function fetchTodayMemories(today: {
	month: number
	day: number
}): Promise<MemoryItem[]> {
	const { token, folderId } = getEnvConfig()
	const client = createClient({ token, type: 'pcloud' })
	const cache = createCaptureCache(getCaptureCacheStore())
	const files = await listMediaFiles(client, folderId)

	type Match = { file: FileMetadata; capture: Date }
	const candidates = await Promise.all(
		files.map(async (file): Promise<Match | null> => {
			const capture = await safeExtractCaptureDate(client, file, cache)
			if (!capture) return null
			const matched = capture.getMonth() + 1 === today.month && capture.getDate() === today.day
			return matched ? { file, capture } : null
		}),
	)
	const matches = candidates.filter((m): m is Match => m !== null)

	// Oldest year first; tiebreak by fileid asc. Deterministic per (folder, day).
	matches.sort(
		(a, b) => a.capture.getFullYear() - b.capture.getFullYear() || a.file.fileid - b.file.fileid,
	)

	return matches.map((m) => buildMemoryItem(m.file, m.capture))
}
