import type { FetchBytes } from '#/lib/memories/memory-route.server'

import { loadServerUser } from '#/lib/auth/auth.server'
import { createMediaCache } from '#/lib/cache/media-cache'
import { getMediaCacheStore } from '#/lib/cache/media-cache.server'
import { handleMemoryRequest } from '#/lib/memories/memory-route.server'
import { createFileRoute } from '@tanstack/react-router'
import { createClient } from 'pcloud-kit'

type PublinkDownload = { hosts: readonly string[]; path: string }

async function resolveStreamUrl(code: string): Promise<string> {
	const token = process.env.PCLOUD_TOKEN
	if (!token) throw new Error('PCLOUD_TOKEN is not set')
	const client = createClient({ token })
	// `getpublinkdownload` is not in pcloud-kit's typed method registry, so use
	// `callRaw` (which accepts any method name) instead of `call`.
	const res = await client.callRaw<PublinkDownload>('getpublinkdownload', { code })
	const host = res.hosts[0]
	if (!host) throw new TypeError('getpublinkdownload: no hosts returned')
	return `https://${host}${res.path}`
}

const fetchBytes: FetchBytes = async (url, range) => {
	const headers = new Headers()
	if (range) headers.set('range', range)
	return fetch(url, { headers })
}

export const Route = createFileRoute('/api/memory/$uuid')({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const uuid = (params as { uuid: string }).uuid
				return handleMemoryRequest(request, uuid, {
					loadServerUser,
					mediaCache: createMediaCache(getMediaCacheStore()),
					resolveStreamUrl,
					fetchBytes,
				})
			},
		},
	},
})
