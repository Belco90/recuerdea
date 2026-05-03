// Authenticated proxy for video bytes. The browser hits `/api/video/<uuid>`,
// we resolve the pCloud `getpublinkdownload` CDN URL on the server, then pipe
// the response body straight back. Range headers are forwarded so HTML5
// `<video>` seek/scrub still works.
//
// Why the proxy exists: pCloud's `getpublinkdownload` URLs are signed against
// the calling IP. v9 demolished the v4 byte-streaming proxy and shipped CDN
// URLs straight to the browser, which works for `getpubthumb` (stateless) but
// breaks for `getpublinkdownload` — the URL the SSR mints can't be fetched
// from a different IP. The in-file comment in `pcloud-urls.server.ts` flagged
// this as a deploy-preview smoke item; this file is the fallback that
// comment predicted.

import type { ServerUser } from '../auth/auth.server'
import type { MediaCache } from '../cache/media-cache'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ResolveStreamUrl = (code: string) => Promise<string>
export type FetchBytes = (url: string, range: string | null) => Promise<Response>

export type VideoStreamDeps = {
	loadServerUser: () => Promise<ServerUser | null>
	mediaCache: MediaCache
	resolveStreamUrl: ResolveStreamUrl
	fetchBytes: FetchBytes
}

export async function handleVideoStreamRequest(
	request: Request,
	uuid: string,
	deps: VideoStreamDeps,
): Promise<Response> {
	const user = await deps.loadServerUser()
	if (!user) return new Response('unauthorized', { status: 401 })

	if (!UUID_V4.test(uuid)) return new Response('invalid uuid', { status: 400 })

	const meta = await deps.mediaCache.lookup(uuid)
	if (!meta) return new Response('not found', { status: 404 })
	if (meta.kind !== 'video') return new Response('not a video', { status: 400 })

	try {
		const upstreamUrl = await deps.resolveStreamUrl(meta.code)
		const upstream = await deps.fetchBytes(upstreamUrl, request.headers.get('range'))

		const headers = new Headers({
			'content-type': meta.contenttype,
			'accept-ranges': 'bytes',
			// Short cache: pCloud-signed URLs expire and we re-resolve on each
			// hit, so don't let intermediates serve stale bytes for long.
			'cache-control': 'private, max-age=60',
		})
		const contentLength = upstream.headers.get('content-length')
		if (contentLength) headers.set('content-length', contentLength)
		const contentRange = upstream.headers.get('content-range')
		if (contentRange) headers.set('content-range', contentRange)

		return new Response(upstream.body, { status: upstream.status, headers })
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown error'
		return new Response(`pCloud error: ${message}`, { status: 502 })
	}
}
