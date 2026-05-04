import type { Client, FileMetadata, FolderMetadata } from 'pcloud-kit'

import type { FileidIndex } from '../cache/fileid-index'
import type { FolderCache } from '../cache/folder-cache'
import type { CachedMedia, MediaCache } from '../cache/media-cache'
import type { ReverseGeocodeResult } from '../media-meta/geoapify.server'

import { extractImageMeta } from '../media-meta/exif'
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
// 220ms ≈ 4.5 req/s, just under Geoapify free tier's 5 req/s ceiling.
const DEFAULT_GEOCODE_SLEEP_MS = 220

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

// Per-file outcome of the extraction step. Aggregated into ExtractCounts so the
// cron summary log can answer "is GPS extraction working?" without ever
// emitting filenames, paths, or coordinates.
type ExtractOutcome =
	| 'image-with-location'
	| 'image-no-location'
	| 'image-error'
	| 'video-with-location'
	| 'video-no-location'
	| 'video-error'

export type ExtractCounts = {
	imagesWithLocation: number
	imagesNoLocation: number
	imagesExtractError: number
	videosWithLocation: number
	videosNoLocation: number
	videosExtractError: number
}

const ZERO_EXTRACT_COUNTS: ExtractCounts = {
	imagesWithLocation: 0,
	imagesNoLocation: 0,
	imagesExtractError: 0,
	videosWithLocation: 0,
	videosNoLocation: 0,
	videosExtractError: 0,
}

function bumpExtractCounts(counts: ExtractCounts, outcome: ExtractOutcome): ExtractCounts {
	switch (outcome) {
		case 'image-with-location':
			return { ...counts, imagesWithLocation: counts.imagesWithLocation + 1 }
		case 'image-no-location':
			return { ...counts, imagesNoLocation: counts.imagesNoLocation + 1 }
		case 'image-error':
			return { ...counts, imagesExtractError: counts.imagesExtractError + 1 }
		case 'video-with-location':
			return { ...counts, videosWithLocation: counts.videosWithLocation + 1 }
		case 'video-no-location':
			return { ...counts, videosNoLocation: counts.videosNoLocation + 1 }
		case 'video-error':
			return { ...counts, videosExtractError: counts.videosExtractError + 1 }
	}
}

function isMediaFile(item: FileMetadata | FolderMetadata): item is FileMetadata {
	if (item.isfolder) return false
	const ct = item.contenttype
	return ct.startsWith('image/') || ct.startsWith('video/')
}

async function listMediaFiles(client: Client, folderId: number): Promise<FileMetadata[]> {
	const folder = await client.listfolder(folderId)
	return folder.contents?.filter(isMediaFile) ?? []
}

async function extractFileMeta(
	client: Client,
	file: FileMetadata,
): Promise<{ meta: FileMeta; outcome: ExtractOutcome }> {
	const isVideo = file.contenttype.startsWith('video/')
	try {
		const downloadUrl = await client.getfilelink(file.fileid)
		const meta = isVideo ? await extractVideoMeta(downloadUrl) : await extractImageMeta(downloadUrl)
		const fileMeta: FileMeta = {
			captureDate: parseCapturedDate(file.created),
			width: meta.width,
			height: meta.height,
			location: meta.location,
		}
		const hasLocation = meta.location !== null
		const outcome: ExtractOutcome = isVideo
			? hasLocation
				? 'video-with-location'
				: 'video-no-location'
			: hasLocation
				? 'image-with-location'
				: 'image-no-location'
		return { meta: fileMeta, outcome }
	} catch {
		return { meta: EMPTY_META, outcome: isVideo ? 'video-error' : 'image-error' }
	}
}

function parseCapturedDate(iso: string): Date | null {
	const ms = Date.parse(iso)
	return Number.isNaN(ms) ? null : new Date(ms)
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
): Promise<{ uuid: string; outcome: ExtractOutcome | null; cached: CachedMedia }> {
	const existingUuid = await fileidIndex.lookup(file.fileid)
	const uuid = existingUuid ?? crypto.randomUUID()
	const cached = await mediaCache.lookup(uuid)
	if (!cached || cached.hash !== file.hash) {
		const publink = await ensurePublink(client, file.fileid, cached)
		const { meta, outcome } = await extractFileMeta(client, file)
		const next = fileToCachedMedia(file, publink, meta)
		await mediaCache.remember(uuid, next)
		if (!existingUuid) await fileidIndex.remember(file.fileid, uuid)
		return { uuid, outcome, cached: next }
	}
	return { uuid, outcome: null, cached }
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
	extractCounts: ExtractCounts
	geocoded: number
	// 200-OK responses where the picker returned null (not the same as a
	// failure; the request succeeded, the response just had no usable place).
	// Surfaced separately so the cron summary can distinguish "geocoder
	// silently shrugged at every coord" from "everything worked, just empty."
	geocodeNoPlace: number
	geocodeCapped: number
	// Per-skip-reason counters for runGeocodePass. Together with
	// `geocoded + geocodeNoPlace + geocodeCapped + sum(geocodeFailures) + the
	// four skip counters` they account for every alive uuid the pass iterated.
	// Diagnostic-only — never include coordinates, place strings, or fileids.
	geocodeAttempted: number
	geocodeSkippedNoCached: number
	geocodeSkippedNoLocation: number
	geocodeSkippedAlreadyDone: number
	geocodeSkippedAfterStop: number
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
	const processed = await Promise.all(
		files.map((file) => processFile(client, file, mediaCache, fileidIndex)),
	)
	const aliveUuids = processed.map((p) => p.uuid)
	// In-memory snapshot of just-written entries. The geocode pass reads from
	// here instead of round-tripping through the Blobs store, because the
	// store uses eventual consistency (strong consistency requires
	// `uncachedEdgeURL`, which Netlify scheduled functions don't get from
	// `connectLambda`). Without this snapshot, lookup() returns undefined for
	// every uuid and the geocode pass silently skips everything.
	const aliveCached = new Map(processed.map((p) => [p.uuid, p.cached]))
	const extractCounts = processed.reduce<ExtractCounts>(
		(acc, p) => (p.outcome ? bumpExtractCounts(acc, p.outcome) : acc),
		{ ...ZERO_EXTRACT_COUNTS },
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
		? await runGeocodePass(aliveUuids, aliveCached, mediaCache, geocodeOpts)
		: {
				geocoded: 0,
				noPlace: 0,
				capped: 0,
				attempted: 0,
				skippedNoCached: 0,
				skippedNoLocation: 0,
				skippedAlreadyDone: 0,
				skippedAfterStop: 0,
				failures: { ...ZERO_FAILURES },
				stoppedReason: null,
			}

	return {
		scanned: files.length,
		alive: aliveUuids.length,
		removed: staleUuids.length,
		extractCounts,
		geocoded: geocodeResult.geocoded,
		geocodeNoPlace: geocodeResult.noPlace,
		geocodeCapped: geocodeResult.capped,
		geocodeAttempted: geocodeResult.attempted,
		geocodeSkippedNoCached: geocodeResult.skippedNoCached,
		geocodeSkippedNoLocation: geocodeResult.skippedNoLocation,
		geocodeSkippedAlreadyDone: geocodeResult.skippedAlreadyDone,
		geocodeSkippedAfterStop: geocodeResult.skippedAfterStop,
		geocodeFailures: geocodeResult.failures,
		geocodeStoppedReason: geocodeResult.stoppedReason,
	}
}

async function runGeocodePass(
	aliveUuids: readonly string[],
	aliveCached: ReadonlyMap<string, CachedMedia>,
	mediaCache: MediaCache,
	opts: GeocodeOpts,
): Promise<{
	geocoded: number
	noPlace: number
	capped: number
	attempted: number
	skippedNoCached: number
	skippedNoLocation: number
	skippedAlreadyDone: number
	skippedAfterStop: number
	failures: Record<FailureReason, number>
	stoppedReason: FailureReason | null
}> {
	const cap = opts.cap ?? DEFAULT_GEOCODE_CAP
	const sleepMs = opts.sleepMs ?? DEFAULT_GEOCODE_SLEEP_MS
	const sleep = opts.sleep ?? defaultSleep
	const geocoder = opts.geocoder ?? defaultReverseGeocode

	const failures: Record<FailureReason, number> = { ...ZERO_FAILURES }
	let geocoded = 0
	let noPlace = 0
	let capped = 0
	let attempts = 0
	let skippedNoCached = 0
	let skippedNoLocation = 0
	let skippedAlreadyDone = 0
	let skippedAfterStop = 0
	let stopped: FailureReason | null = null

	// Sequential by design: Geoapify's free tier caps at 5 req/s and we pace
	// just under that via `sleep`. Parallelizing would risk bursts past the
	// ceiling and trip 429s; the cap (default 200) bounds total per-run cost.
	/* eslint-disable no-await-in-loop */
	for (const uuid of aliveUuids) {
		const cached = aliveCached.get(uuid)
		if (!cached) {
			skippedNoCached += 1
			continue
		}
		if (cached.location === null) {
			skippedNoLocation += 1
			continue
		}
		if (cached.place !== null) {
			skippedAlreadyDone += 1
			continue
		}

		if (stopped !== null) {
			skippedAfterStop += 1
			continue
		}
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
			} else {
				noPlace += 1
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

	return {
		geocoded,
		noPlace,
		capped,
		attempted: attempts,
		skippedNoCached,
		skippedNoLocation,
		skippedAlreadyDone,
		skippedAfterStop,
		failures,
		stoppedReason: stopped,
	}
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
