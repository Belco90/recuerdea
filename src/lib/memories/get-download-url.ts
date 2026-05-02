import { createServerFn } from '@tanstack/react-start'

import type { DownloadUrlInfo } from './get-download-url.server'

type Input = { uuid: string }

function parseInput(input: unknown): Input | null {
	if (!input || typeof input !== 'object') return null
	const obj = input as Record<string, unknown>
	if (typeof obj.uuid !== 'string' || obj.uuid.length === 0) return null
	return { uuid: obj.uuid }
}

export const getMediaDownloadUrl = createServerFn({ method: 'GET' })
	.inputValidator((input: unknown): Input | null => parseInput(input))
	.handler(async ({ data }): Promise<DownloadUrlInfo> => {
		if (!data) throw new Error('invalid input')

		const { loadServerUser } = await import('../auth/auth.server')
		const { createMediaCache } = await import('../cache/media-cache')
		const { getMediaCacheStore } = await import('../cache/media-cache.server')
		const { resolveDownloadUrl } = await import('./get-download-url.server')

		const token = process.env.PCLOUD_TOKEN
		if (!token) throw new Error('PCLOUD_TOKEN is not set')

		const { createClient } = await import('pcloud-kit')
		return resolveDownloadUrl(data.uuid, {
			loadServerUser,
			mediaCache: createMediaCache(getMediaCacheStore()),
			client: createClient({ token }),
		})
	})
