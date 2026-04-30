import type { Client, FileMetadata, FolderMetadata } from 'pcloud-kit'

import type { FileidIndex } from './fileid-index'
import type { FolderCache } from './folder-cache'
import type { CachedMedia, MediaCache } from './media-cache'

import { extractImageMeta } from './exif'
import { parseFilenameCaptureDate } from './filename-date'
import { extractVideoMeta } from './video-meta'

type Publink = { code: string; linkid: number }

type FileMeta = {
	captureDate: Date | null
	width: number | null
	height: number | null
}

const EMPTY_META: FileMeta = { captureDate: null, width: null, height: null }

function isMediaFile(item: FileMetadata | FolderMetadata): item is FileMetadata {
	if (item.isfolder) return false
	const ct = item.contenttype
	return ct.startsWith('image/') || ct.startsWith('video/')
}

async function listMediaFiles(client: Client, folderId: number): Promise<FileMetadata[]> {
	const folder = await client.listfolder(folderId)
	return folder.contents?.filter(isMediaFile) ?? []
}

async function extractFileMeta(client: Client, file: FileMetadata): Promise<FileMeta> {
	try {
		const downloadUrl = await client.getfilelink(file.fileid)
		const meta = file.contenttype.startsWith('video/')
			? await extractVideoMeta(downloadUrl)
			: await extractImageMeta(downloadUrl)
		return {
			captureDate: meta.captureDate ?? parseFilenameCaptureDate(file.name) ?? null,
			width: meta.width,
			height: meta.height,
		}
	} catch {
		return EMPTY_META
	}
}

async function ensurePublink(
	client: Client,
	fileid: number,
	cached: Pick<CachedMedia, 'code' | 'linkid'> | undefined,
): Promise<Publink> {
	if (cached?.code && cached.linkid) {
		return { code: cached.code, linkid: cached.linkid }
	}
	// `getfilepublink` is idempotent for an existing fileid (verified by curl
	// 2026-04-29 — repeat calls return identical { code, linkid }).
	const res = await client.call<{ code: string; linkid: number }>('getfilepublink', { fileid })
	return { code: res.code, linkid: res.linkid }
}

function fileToCachedMedia(file: FileMetadata, publink: Publink, meta: FileMeta): CachedMedia {
	return {
		fileid: file.fileid,
		hash: file.hash,
		code: publink.code,
		linkid: publink.linkid,
		kind: file.contenttype.startsWith('video/') ? 'video' : 'image',
		contenttype: file.contenttype,
		name: file.name,
		captureDate: meta.captureDate ? meta.captureDate.toISOString() : null,
		width: meta.width,
		height: meta.height,
	}
}

async function processFile(
	client: Client,
	file: FileMetadata,
	mediaCache: MediaCache,
	fileidIndex: FileidIndex,
): Promise<string> {
	const existingUuid = await fileidIndex.lookup(file.fileid)
	const uuid = existingUuid ?? crypto.randomUUID()
	const cached = await mediaCache.lookup(uuid)
	if (!cached || cached.hash !== file.hash) {
		const publink = await ensurePublink(client, file.fileid, cached)
		const meta = await extractFileMeta(client, file)
		const next = fileToCachedMedia(file, publink, meta)
		await mediaCache.remember(uuid, next)
		if (!existingUuid) await fileidIndex.remember(file.fileid, uuid)
	}
	return uuid
}

async function sweepUuid(
	client: Client,
	uuid: string,
	mediaCache: MediaCache,
	fileidIndex: FileidIndex,
): Promise<void> {
	const meta = await mediaCache.lookup(uuid)
	if (meta) {
		try {
			await client.call('deletepublink', { linkid: meta.linkid })
		} catch {
			// best-effort: keep going even if delete fails (link may already be gone)
		}
		await fileidIndex.forget(meta.fileid)
	}
	await mediaCache.forget(uuid)
}

export async function refreshMemories(
	client: Client,
	folderId: number,
	mediaCache: MediaCache,
	fileidIndex: FileidIndex,
	folderCache: FolderCache,
): Promise<{ scanned: number; alive: number; removed: number }> {
	const files = await listMediaFiles(client, folderId)
	const aliveUuids = await Promise.all(
		files.map((file) => processFile(client, file, mediaCache, fileidIndex)),
	)

	const aliveSet = new Set(aliveUuids)
	const allCachedUuids = await mediaCache.listUuids()
	const staleUuids = allCachedUuids.filter((uuid) => !aliveSet.has(uuid))
	await Promise.all(staleUuids.map((uuid) => sweepUuid(client, uuid, mediaCache, fileidIndex)))

	await folderCache.remember({
		refreshedAt: new Date().toISOString(),
		uuids: aliveUuids,
	})

	return { scanned: files.length, alive: aliveUuids.length, removed: staleUuids.length }
}
