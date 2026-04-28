import { type Client, type FileMetadata, type FolderMetadata, createClient } from 'pcloud-kit'

import { extractCaptureDate } from './exif'
import { parseFilenameCaptureDate } from './filename-date'
import { extractVideoCaptureDate } from './video-meta'

export type MemoryItem =
	| { kind: 'image'; url: string; name: string; captureDate: string }
	| {
			kind: 'video'
			url: string
			mimeType: string
			posterUrl: string
			name: string
			captureDate: string
	  }

type GetThumbLinkResponse = { hosts: string[]; path: string }

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

async function fetchThumbnailUrl(client: Client, fileid: number): Promise<string> {
	const thumb = await client.call<GetThumbLinkResponse>('getthumblink', {
		fileid,
		size: '2048x1024',
	})
	return `https://${thumb.hosts[0]}${thumb.path}`
}

async function fetchVideoStreamUrl(client: Client, fileid: number): Promise<string> {
	return client.getfilelink(fileid)
}

async function safeExtractCaptureDate(client: Client, file: FileMetadata): Promise<Date | null> {
	try {
		const downloadUrl = await client.getfilelink(file.fileid)
		const exifCapture = isVideo(file)
			? await extractVideoCaptureDate(downloadUrl)
			: await extractCaptureDate(downloadUrl)
		if (exifCapture) return exifCapture

		const filenameCapture = parseFilenameCaptureDate(file.name)
		if (filenameCapture) {
			return filenameCapture
		}
		return null
	} catch {
		return null
	}
}

async function buildMemoryItem(
	client: Client,
	file: FileMetadata,
	capture: Date,
): Promise<MemoryItem> {
	const captureDate = capture.toISOString()
	if (isVideo(file)) {
		const [url, posterUrl] = await Promise.all([
			fetchVideoStreamUrl(client, file.fileid),
			fetchThumbnailUrl(client, file.fileid),
		])
		return {
			kind: 'video',
			url,
			mimeType: file.contenttype,
			posterUrl,
			name: file.name,
			captureDate,
		}
	}
	const url = await fetchThumbnailUrl(client, file.fileid)
	return { kind: 'image', url, name: file.name, captureDate }
}

export async function fetchTodayMemories(today: {
	month: number
	day: number
}): Promise<MemoryItem[]> {
	const { token, folderId } = getEnvConfig()
	const client = createClient({ token, type: 'pcloud' })
	const files = await listMediaFiles(client, folderId)

	type Match = { file: FileMetadata; capture: Date }
	const candidates = await Promise.all(
		files.map(async (file): Promise<Match | null> => {
			const capture = await safeExtractCaptureDate(client, file)
			if (!capture) return null
			const matched = capture.getMonth() + 1 === today.month && capture.getDate() === today.day
			// eslint-disable-next-line no-console
			console.log('[memories] file', {
				fileid: file.fileid,
				name: file.name,
				contenttype: file.contenttype,
				captureIso: capture.toISOString(),
				matched,
			})
			return matched ? { file, capture } : null
		}),
	)
	const matches = candidates.filter((m): m is Match => m !== null)
	// eslint-disable-next-line no-console
	console.log('[memories] summary', {
		today,
		totalFiles: files.length,
		matched: matches.length,
	})

	// Oldest year first; tiebreak by fileid asc. Deterministic per (folder, day).
	matches.sort(
		(a, b) => a.capture.getFullYear() - b.capture.getFullYear() || a.file.fileid - b.file.fileid,
	)

	return Promise.all(matches.map((m) => buildMemoryItem(client, m.file, m.capture)))
}
