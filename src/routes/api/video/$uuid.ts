import { loadServerUser } from '#/lib/auth/auth.server'
import { createMediaCache } from '#/lib/cache/media-cache'
import { getMediaCacheStore } from '#/lib/cache/media-cache.server'
import { resolvePubVideoUrl } from '#/lib/memories/pcloud-urls.server'
import { handleVideoStreamRequest } from '#/lib/memories/video-stream.server'
import { createFileRoute } from '@tanstack/react-router'
import { createClient } from 'pcloud-kit'

export const Route = createFileRoute('/api/video/$uuid')({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const uuid = (params as { uuid: string }).uuid
				return handleVideoStreamRequest(request, uuid, {
					loadServerUser,
					mediaCache: createMediaCache(getMediaCacheStore()),
					resolveStreamUrl: async (code) => {
						const token = process.env.PCLOUD_TOKEN
						if (!token) throw new Error('PCLOUD_TOKEN is not set')
						const client = createClient({ token })
						return resolvePubVideoUrl(client, code)
					},
					resolveDownloadUrl: async (code) => {
						const token = process.env.PCLOUD_TOKEN
						if (!token) throw new Error('PCLOUD_TOKEN is not set')
						const client = createClient({ token })
						// Same transcoded H.264 variant as the stream path. Android
						// can't decode HEVC; the original iPhone .mov fails to play
						// (audio-only) when downloaded. The proxy advertises
						// `video/mp4` + a `.mp4` filename to match the actual bytes.
						return resolvePubVideoUrl(client, code)
					},
					fetchBytes: async (url, range) => {
						const headers = new Headers()
						if (range) headers.set('range', range)
						return fetch(url, { headers })
					},
				})
			},
		},
	},
})
