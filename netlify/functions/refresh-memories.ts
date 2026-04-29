import { createFileidIndex } from '#/lib/fileid-index'
import { getFileidIndexStore } from '#/lib/fileid-index.server'
import { createFolderCache } from '#/lib/folder-cache'
import { getFolderCacheStore } from '#/lib/folder-cache.server'
import { createMediaCache } from '#/lib/media-cache'
import { getMediaCacheStore } from '#/lib/media-cache.server'
import { refreshMemories } from '#/lib/refresh-memories.server'
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

export const handler = schedule('0 4 * * *', async () => {
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
