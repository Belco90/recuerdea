import type { Client, FileMetadata, FolderMetadata } from 'pcloud-kit'

import type { FileidIndex } from '../cache/fileid-index'
import type { FolderCache } from '../cache/folder-cache'
import type { CachedMedia, MediaCache } from '../cache/media-cache'
import type { ReverseGeocodeResult } from '../media-meta/geoapify.server'

import { extractImageMeta } from '../media-meta/exif'
import { parseFilenameCaptureDate } from '../media-meta/filename-date'
import { reverseGeocode as defaultReverseGeocode } from '../media-meta/geoapify.server'
import { extractVideoMeta } from '../media-meta/video-meta'

type Geocoder = (
	input: { lat: number; lng: number },
	opts: { apiKey: string },
) => Promise<ReverseGeocodeResult>

type FailureReason = 'auth' | 'suspended' | 'ratelimit' | 'server' | 'network' | 'parse'

const STOP_REASONS = new Set<FailureReason>(['auth', 'suspended', 'ratelimit'])
const WARN_REASONS = new Set<FailureReason>(['auth', 'suspended'])

const DEFAULT_GEOCODE_CAP = 200
const DEFAULT_GEOCODE_SLEEP_MS = 1100

export type GeocodeOpts = {
	apiKey: string
	cap?: number
	sleepMs?: number
	sleep?: (ms: number) => Promise<void>
	geocoder?: Geocoder
}

const ZERO_FAILURES: Record<FailureReason, number> = {
	auth: 0,
	suspended: 0,
	ratelimit: 0,
	server: 0,
	network: 0,
	parse: 0,
}

type Publink = { code: string; linkid: number }

type FileMeta = {
	captureDate: Date | null
	width: number | null
	height: number | null
	location: { lat: number; lng: number } | null
}

const EMPTY_META: FileMeta = { captureDate: null, width: null, height: null, location: null }

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
			location: meta.location,
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
		location: meta.location,
		place: null,
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

export type RefreshResult = {
	scanned: number
	alive: number
	removed: number
	geocoded: number
	geocodeCapped: number
	geocodeFailures: Record<FailureReason, number>
	geocodeStoppedReason: FailureReason | null
}

export async function refreshMemories(
	client: Client,
	folderId: number,
	mediaCache: MediaCache,
	fileidIndex: FileidIndex,
	folderCache: FolderCache,
	geocodeOpts?: GeocodeOpts,
): Promise<RefreshResult> {
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

	const geocodeResult = geocodeOpts
		? await runGeocodePass(aliveUuids, mediaCache, geocodeOpts)
		: { geocoded: 0, capped: 0, failures: { ...ZERO_FAILURES }, stoppedReason: null }

	return {
		scanned: files.length,
		alive: aliveUuids.length,
		removed: staleUuids.length,
		geocoded: geocodeResult.geocoded,
		geocodeCapped: geocodeResult.capped,
		geocodeFailures: geocodeResult.failures,
		geocodeStoppedReason: geocodeResult.stoppedReason,
	}
}

async function runGeocodePass(
	aliveUuids: readonly string[],
	mediaCache: MediaCache,
	opts: GeocodeOpts,
): Promise<{
	geocoded: number
	capped: number
	failures: Record<FailureReason, number>
	stoppedReason: FailureReason | null
}> {
	const cap = opts.cap ?? DEFAULT_GEOCODE_CAP
	const sleepMs = opts.sleepMs ?? DEFAULT_GEOCODE_SLEEP_MS
	const sleep = opts.sleep ?? defaultSleep
	const geocoder = opts.geocoder ?? defaultReverseGeocode

	const failures: Record<FailureReason, number> = { ...ZERO_FAILURES }
	let geocoded = 0
	let capped = 0
	let attempts = 0
	let stopped: FailureReason | null = null

	// Sequential by design: Geoapify's free tier caps at 5 req/s but we keep a
	// 1-req/s budget in software via `sleep`. Parallelizing would burn the
	// daily quota in seconds and trip 429s.
	/* eslint-disable no-await-in-loop */
	for (const uuid of aliveUuids) {
		const cached = await mediaCache.lookup(uuid)
		if (!cached || cached.location === null || cached.place !== null) continue

		if (stopped !== null) continue
		if (attempts >= cap) {
			capped += 1
			continue
		}
		if (attempts > 0) await sleep(sleepMs)
		attempts += 1

		const result = await geocoder(cached.location, { apiKey: opts.apiKey })

		if (result.ok) {
			if (result.place !== null) {
				await mediaCache.remember(uuid, { ...cached, place: result.place })
				geocoded += 1
			}
			continue
		}

		failures[result.reason] += 1
		if (STOP_REASONS.has(result.reason)) {
			stopped = result.reason
			if (WARN_REASONS.has(result.reason)) {
				// eslint-disable-next-line no-console
				console.warn(`[refresh] geocode disabled: ${result.reason}`)
			}
		}
	}
	/* eslint-enable no-await-in-loop */

	return { geocoded, capped, failures, stoppedReason: stopped }
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
