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
	const client = createClient({ token, type: 'pcloud' })
	const mediaCache = createMediaCache(getMediaCacheStore())
	const fileidIndex = createFileidIndex(getFileidIndexStore())
	const folderCache = createFolderCache(getFolderCacheStore())

	const result = await refreshMemories(client, folderId, mediaCache, fileidIndex, folderCache)

	// eslint-disable-next-line no-console
	console.log(
		`[refresh-memories] scanned=${result.scanned} alive=${result.alive} removed=${result.removed}`,
	)
	return { statusCode: 200 }
})
