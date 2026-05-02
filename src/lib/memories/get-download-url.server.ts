import type { Client } from 'pcloud-kit'

import type { ServerUser } from '../auth/auth.server'
import type { MediaCache } from '../cache/media-cache'

import { resolveMediaUrl } from './pcloud-urls.server'

export type DownloadUrlInfo = { url: string; name: string; contenttype: string }

export type DownloadUrlDeps = {
	loadServerUser: () => Promise<ServerUser | null>
	mediaCache: MediaCache
	client: Client
}

export async function resolveDownloadUrl(
	uuid: string,
	deps: DownloadUrlDeps,
): Promise<DownloadUrlInfo> {
	const user = await deps.loadServerUser()
	if (!user) throw new Error('unauthenticated')
	const meta = await deps.mediaCache.lookup(uuid)
	if (!meta) throw new Error('not found')
	const url = await resolveMediaUrl(deps.client, meta.code)
	return { url, name: meta.name, contenttype: meta.contenttype }
}
