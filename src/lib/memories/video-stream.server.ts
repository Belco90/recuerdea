// Authenticated proxy for video bytes. The browser hits `/api/video/<uuid>`,
// we resolve the pCloud `getpublinkdownload` CDN URL on the server, then pipe
// the response body straight back. Range headers are forwarded for the stream
// path so HTML5 `<video>` seek/scrub still works; the `?download=1` variant
// forces a full-file response with `Content-Disposition: attachment`.
//
// Why the proxy exists: pCloud's `getpublinkdownload` URLs are signed against
// the calling IP. v9 demolished the v4 byte-streaming proxy and shipped CDN
// URLs straight to the browser, which works for `getpubthumb` (stateless) but
// breaks for `getpublinkdownload` — the URL the SSR mints can't be fetched
// from a different IP. The in-file comment in `pcloud-urls.server.ts` flagged
// this as a deploy-preview smoke item; this file is the fallback that
// comment predicted.

import type { ServerUser } from '../auth/auth.server'
import type { CachedMedia, MediaCache } from '../cache/media-cache'

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

	const isDownload = new URL(request.url).searchParams.get('download') === '1'
	// Downloads must always deliver the full file — never honor a Range header
	// here, even if the browser sent one.
	const range = isDownload ? null : request.headers.get('range')

	try {
		const upstreamUrl = await deps.resolveStreamUrl(meta.code)
		const upstream = await deps.fetchBytes(upstreamUrl, range)
		return isDownload ? buildDownloadResponse(upstream, meta) : buildStreamResponse(upstream, meta)
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown error'
		return new Response(`pCloud error: ${message}`, { status: 502 })
	}
}

function buildStreamResponse(upstream: Response, meta: CachedMedia): Response {
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
}

function buildDownloadResponse(upstream: Response, meta: CachedMedia): Response {
	const headers = new Headers({
		'content-type': meta.contenttype,
		'cache-control': 'private, max-age=0, no-store',
		'content-disposition': buildContentDisposition(meta.name),
	})
	const contentLength = upstream.headers.get('content-length')
	if (contentLength) headers.set('content-length', contentLength)
	// Force 200 — strip any upstream `content-range` semantics that would
	// otherwise confuse the browser save dialog.
	return new Response(upstream.body, { status: 200, headers })
}

function buildContentDisposition(name: string): string {
	const fallback = asciiFallbackFilename(name) || 'download'
	const utf8 = encodeURIComponent(name)
	return `attachment; filename="${fallback}"; filename*=UTF-8''${utf8}`
}

function asciiFallbackFilename(name: string): string {
	// Strip non-printable and characters that need escaping inside a quoted
	// `filename="…"` (control chars, double-quote, backslash). Browsers that
	// understand `filename*=UTF-8''…` use that one; the ASCII version is the
	// fallback for clients that don't.
	return name.replace(/[^\x20-\x21\x23-\x5b\x5d-\x7e]/g, '')
}
