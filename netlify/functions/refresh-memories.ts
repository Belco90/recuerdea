import { createFileidIndex } from '#/lib/cache/fileid-index'
import { getFileidIndexStore } from '#/lib/cache/fileid-index.server'
import { createFolderCache } from '#/lib/cache/folder-cache'
import { getFolderCacheStore } from '#/lib/cache/folder-cache.server'
import { createMediaCache } from '#/lib/cache/media-cache'
import { getMediaCacheStore } from '#/lib/cache/media-cache.server'
import { refreshMemories } from '#/lib/memories/refresh-memories.server'
import { connectLambda } from '@netlify/blobs'
import { schedule } from '@netlify/functions'
import { createClient } from 'pcloud-kit'

function getEnvConfig(): { token: string; folderId: number } {
	const token = process.env.PCLOUD_TOKEN
	const folderIdRaw = process.env.PCLOUD_MEMORIES_FOLDER_ID
	if (!token) throw new Error('PCLOUD_TOKEN is not set')
	if (!folderIdRaw) throw new Error('PCLOUD_MEMORIES_FOLDER_ID is not set')
	const folderId = Number(folderIdRaw)
	if (!Number.isInteger(folderId)) throw new Error('PCLOUD_MEMORIES_FOLDER_ID must be an integer')
	return { token, folderId }
}

export const handler = schedule('0 4 * * *', async (event) => {
	// Scheduled functions don't get the automatic Blobs context that on-demand
	// SSR functions get — we have to wire it up explicitly. Without this the
	// `getStore` calls in the cache factories throw and fall back to no-op
	// stores (which silently swallow writes).
	//
	// `HandlerEvent` from @netlify/functions doesn't declare the `blobs` field
	// that Netlify's runtime injects into scheduled-function events, so we cast
	// to the shape `connectLambda` expects.
	connectLambda(event as unknown as Parameters<typeof connectLambda>[0])

	const { token, folderId } = getEnvConfig()
	const client = createClient({ token })
	const mediaCache = createMediaCache(getMediaCacheStore())
	const fileidIndex = createFileidIndex(getFileidIndexStore())
	const folderCache = createFolderCache(getFolderCacheStore())

	const apiKey = process.env.GEOAPIFY_API_KEY
	const capRaw = process.env.RECUERDEA_GEOCODE_MAX_PER_RUN
	const cap = capRaw && Number.isInteger(Number(capRaw)) ? Number(capRaw) : undefined
	if (!apiKey) {
		// eslint-disable-next-line no-console
		console.warn('[refresh] geocode skipped: no api key')
	}

	const result = await refreshMemories(
		client,
		folderId,
		mediaCache,
		fileidIndex,
		folderCache,
		apiKey ? { apiKey, cap } : undefined,
	)

	const e = result.extractCounts
	// eslint-disable-next-line no-console
	console.log(
		`[refresh-memories] scanned=${result.scanned} alive=${result.alive} removed=${result.removed}` +
			` img=${e.imagesWithLocation}/${e.imagesNoLocation}/${e.imagesExtractError} (gps/no-gps/err)` +
			` vid=${e.videosWithLocation}/${e.videosNoLocation}/${e.videosExtractError} (gps/no-gps/err)` +
			` geocoded=${result.geocoded} noPlace=${result.geocodeNoPlace} capped=${result.geocodeCapped} stopped=${result.geocodeStoppedReason ?? 'no'}`,
	)
	// eslint-disable-next-line no-console
	console.log(
		`[refresh-memories] geocode skip stats: attempted=${result.geocodeAttempted}` +
			` noCached=${result.geocodeSkippedNoCached}` +
			` noLocation=${result.geocodeSkippedNoLocation}` +
			` alreadyDone=${result.geocodeSkippedAlreadyDone}` +
			` afterStop=${result.geocodeSkippedAfterStop}`,
	)
	const f = result.geocodeFailures
	if (f.auth || f.suspended || f.ratelimit || f.server || f.network || f.parse) {
		// eslint-disable-next-line no-console
		console.log(
			`[refresh-memories] geocode failures: auth=${f.auth} suspended=${f.suspended} ratelimit=${f.ratelimit} server=${f.server} network=${f.network} parse=${f.parse}`,
		)
	}
	return { statusCode: 200 }
})
