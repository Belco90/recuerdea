// Authenticated proxy for video bytes. The browser hits `/api/video/<uuid>`
// and this handler resolves the upstream pCloud CDN URL on the server, then
// pipes the response body straight back. Both stream and download paths go
// through here because pCloud's signed CDN URLs (`getpubvideolinks`,
// `getpublinkdownload`) are IP-bound — the URL the SSR mints is rejected
// with 410 "another IP address" when the browser fetches it.
//
// Stream path (`/api/video/<uuid>`): upstream is `getpubvideolinks` —
// pCloud's pre-transcoded H.264 variant of the video. We force
// `Content-Type: video/mp4` on the response so iPhone QuickTime sources
// play in browsers that wouldn't decode the original container.
//
// Download path (`/api/video/<uuid>?download=1`): upstream is **the same
// `getpubvideolinks` H.264 variant** as the stream path. Serving the
// original file (`getpublinkdownload`) used to ship iPhone HEVC `.mov`
// bytes that Android can't decode (audio-only). The response advertises
// `Content-Type: video/mp4` and renames the filename to `.mp4` so the
// label matches the bytes. `Content-Disposition: attachment` forces the
// save dialog. Trade-off: downloads are no longer byte-identical to the
// source; users wanting the original can grab it from pCloud directly.

import type { ServerUser } from '../auth/auth.server'
import type { CachedMedia, MediaCache } from '../cache/media-cache'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const STREAM_CONTENT_TYPE = 'video/mp4'

export type ResolveStreamUrl = (code: string) => Promise<string>
export type ResolveDownloadUrl = (code: string) => Promise<string>
export type FetchBytes = (url: string, range: string | null) => Promise<Response>

export type VideoStreamDeps = {
	loadServerUser: () => Promise<ServerUser | null>
	mediaCache: MediaCache
	resolveStreamUrl: ResolveStreamUrl
	resolveDownloadUrl: ResolveDownloadUrl
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
		const upstreamUrl = isDownload
			? await deps.resolveDownloadUrl(meta.code)
			: await deps.resolveStreamUrl(meta.code)
		const upstream = await deps.fetchBytes(upstreamUrl, range)
		return isDownload ? buildDownloadResponse(upstream, meta) : buildStreamResponse(upstream)
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown error'
		return new Response(`pCloud error: ${message}`, { status: 502 })
	}
}

function buildStreamResponse(upstream: Response): Response {
	const headers = new Headers({
		// Stamp video/mp4 regardless of the source's contenttype. The picked
		// `getpubvideolinks` variant is H.264 — pCloud delivers these as MP4 —
		// so labeling QuickTime/HEVC sources as video/mp4 matches the bytes
		// being shipped and unblocks Safari macOS + Chrome Android playback.
		'content-type': STREAM_CONTENT_TYPE,
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
	// Bytes shipped are pCloud's transcoded H.264 MP4 (see route shell —
	// download path resolves via `getpubvideolinks`, same source as stream).
	// Stamp `video/mp4` and rename the filename to `.mp4` so the response
	// matches reality on strict-MIME Android players.
	const downloadName = normalizeFilenameToMp4(meta.name)
	const headers = new Headers({
		'content-type': 'video/mp4',
		'cache-control': 'private, max-age=0, no-store',
		'content-disposition': buildContentDisposition(downloadName),
	})
	const contentLength = upstream.headers.get('content-length')
	if (contentLength) headers.set('content-length', contentLength)
	// Force 200 — strip any upstream `content-range` semantics that would
	// otherwise confuse the browser save dialog.
	return new Response(upstream.body, { status: 200, headers })
}

function normalizeFilenameToMp4(name: string): string {
	const lastDot = name.lastIndexOf('.')
	const base = lastDot > 0 ? name.slice(0, lastDot) : name
	return `${base}.mp4`
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
