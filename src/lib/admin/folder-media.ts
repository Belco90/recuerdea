import { createServerFn } from '@tanstack/react-start'

import type { AdminMediaItem } from './folder-media.server'

export type { AdminMediaItem }

export const getAdminFolderMedia = createServerFn({ method: 'GET' }).handler(
	async (): Promise<AdminMediaItem[]> => {
		// Hard auth + admin gate. Same pattern as src/lib/memories/pcloud.ts.
		const { loadServerUser } = await import('../auth/auth.server')
		const user = await loadServerUser()
		if (!user) throw new Error('unauthenticated')
		if (!user.isAdmin) throw new Error('forbidden')

		const { fetchAdminFolderMedia } = await import('./folder-media.server')
		return fetchAdminFolderMedia()
	},
)
