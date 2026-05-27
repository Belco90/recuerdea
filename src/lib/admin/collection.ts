import { createServerFn } from '@tanstack/react-start'

import type { AdminMediaItem } from './folder-media.server'

export type { AdminMediaItem }

type LinkInput = { uuids: readonly string[] }

function parseLinkInput(input: unknown): LinkInput | null {
	if (!input || typeof input !== 'object') return null
	const obj = input as Record<string, unknown>
	if (!Array.isArray(obj.uuids)) return null
	if (obj.uuids.length === 0) return null
	if (!obj.uuids.every((u): u is string => typeof u === 'string' && u.length > 0)) return null
	return { uuids: obj.uuids }
}

async function gateAdmin(): Promise<void> {
	const { loadServerUser } = await import('../auth/auth.server')
	const user = await loadServerUser()
	if (!user) throw new Error('unauthenticated')
	if (!user.isAdmin) throw new Error('forbidden')
}

async function makeDeps() {
	const token = process.env.PCLOUD_TOKEN
	if (!token) throw new Error('PCLOUD_TOKEN is not set')
	const { createClient } = await import('pcloud-kit')
	const { createFileidIndex } = await import('../cache/fileid-index')
	const { getFileidIndexStore } = await import('../cache/fileid-index.server')
	const { createMediaCache } = await import('../cache/media-cache')
	const { getMediaCacheStore } = await import('../cache/media-cache.server')
	return {
		client: createClient({ token }),
		fileidIndex: createFileidIndex(getFileidIndexStore()),
		mediaCache: createMediaCache(getMediaCacheStore()),
	}
}

export const getCollectionMedia = createServerFn({ method: 'GET' }).handler(
	async (): Promise<AdminMediaItem[]> => {
		await gateAdmin()
		const { client, fileidIndex, mediaCache } = await makeDeps()
		const { fetchCollectionMedia } = await import('./collection.server')
		return fetchCollectionMedia(client, fileidIndex, mediaCache)
	},
)

export const linkFilesToCollection = createServerFn({ method: 'POST' })
	.inputValidator((input: unknown): LinkInput | null => parseLinkInput(input))
	.handler(async ({ data }): Promise<void> => {
		if (!data) throw new Error('invalid input')
		await gateAdmin()
		const { client, mediaCache } = await makeDeps()
		const { linkFilesToCollectionRaw } = await import('./collection.server')
		await linkFilesToCollectionRaw(client, mediaCache, data.uuids)
	})

export const unlinkFilesFromCollection = createServerFn({ method: 'POST' })
	.inputValidator((input: unknown): LinkInput | null => parseLinkInput(input))
	.handler(async ({ data }): Promise<void> => {
		if (!data) throw new Error('invalid input')
		await gateAdmin()
		const { client, mediaCache } = await makeDeps()
		const { unlinkFilesFromCollectionRaw } = await import('./collection.server')
		await unlinkFilesFromCollectionRaw(client, mediaCache, data.uuids)
	})
