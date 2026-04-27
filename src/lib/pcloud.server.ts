import { type Client, type FileMetadata, type FolderMetadata, createClient } from 'pcloud-kit'

import { extractCaptureDate } from './exif'

export type MemoryImage = { url: string; name: string; captureDate: string | null }

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

function isImageFile(item: FileMetadata | FolderMetadata): item is FileMetadata {
	return !item.isfolder && item.contenttype.startsWith('image/')
}

async function listImages(client: Client, folderId: number): Promise<FileMetadata[]> {
	const folder = await client.listfolder(folderId)
	return folder.contents?.filter(isImageFile) ?? []
}

async function fetchThumbnailUrl(client: Client, fileid: number): Promise<string> {
	const thumb = await client.call<GetThumbLinkResponse>('getthumblink', {
		fileid,
		size: '2048x1024',
	})
	return `https://${thumb.hosts[0]}${thumb.path}`
}

async function safeExtractCaptureDate(client: Client, fileid: number): Promise<Date | null> {
	try {
		const downloadUrl = await client.getfilelink(fileid)
		return await extractCaptureDate(downloadUrl)
	} catch {
		return null
	}
}

export async function fetchTodayMemoryImage(today: {
	month: number
	day: number
}): Promise<MemoryImage | null> {
	const { token, folderId } = getEnvConfig()
	const client = createClient({ token, type: 'pcloud' })
	const images = await listImages(client, folderId)

	type Match = { image: FileMetadata; capture: Date }
	const candidates = await Promise.all(
		images.map(async (image): Promise<Match | null> => {
			const capture = await safeExtractCaptureDate(client, image.fileid)
			if (!capture) return null
			if (capture.getMonth() + 1 !== today.month) return null
			if (capture.getDate() !== today.day) return null
			return { image, capture }
		}),
	)
	const matches = candidates.filter((m): m is Match => m !== null)

	if (matches.length === 0) return null

	// Oldest year first; tiebreak by fileid asc. Deterministic per (folder, day).
	matches.sort(
		(a, b) => a.capture.getFullYear() - b.capture.getFullYear() || a.image.fileid - b.image.fileid,
	)

	const winner = matches[0]
	const url = await fetchThumbnailUrl(client, winner.image.fileid)
	return { url, name: winner.image.name, captureDate: winner.capture.toISOString() }
}

export async function fetchRandomMemoryImage(): Promise<MemoryImage | null> {
	const { token, folderId } = getEnvConfig()
	const client = createClient({ token, type: 'pcloud' })
	const images = await listImages(client, folderId)
	if (images.length === 0) return null

	const winner = images[Math.floor(Math.random() * images.length)]
	const url = await fetchThumbnailUrl(client, winner.fileid)
	return { url, name: winner.name, captureDate: null }
}
