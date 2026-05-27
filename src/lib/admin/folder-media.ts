import { createServerFn } from '@tanstack/react-start'

import type { AdminFileItem } from './collection.server'

export type AdminFolderMediaResult = { status: 'ok'; items: AdminFileItem[] }

async function gateAdmin(): Promise<void> {
	const { loadServerUser } = await import('../auth/auth.server')
	const user = await loadServerUser()
	if (!user) throw new Error('unauthenticated')
	if (!user.isAdmin) throw new Error('forbidden')
}

export const getAdminFolderMedia = createServerFn({ method: 'GET' }).handler(
	async (): Promise<AdminFolderMediaResult> => {
		await gateAdmin()
		const { fetchAdminFolderMedia } = await import('./folder-media.server')
		const { createFolderCache } = await import('../cache/folder-cache')
		const { getFolderCacheStore } = await import('../cache/folder-cache.server')
		const { createMediaCache } = await import('../cache/media-cache')
		const { getMediaCacheStore } = await import('../cache/media-cache.server')
		const folder = createFolderCache(getFolderCacheStore())
		const media = createMediaCache(getMediaCacheStore())
		const items = await fetchAdminFolderMedia(folder, media)
		return { status: 'ok', items }
	},
)
