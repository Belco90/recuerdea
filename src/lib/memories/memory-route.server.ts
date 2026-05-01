import type { ServerUser } from '../auth/auth.server'
import type { CachedMedia, MediaCache } from '../cache/media-cache'

export type MediaVariant = 'thumb' | 'stream' | 'download'

const VARIANTS: readonly MediaVariant[] = ['thumb', 'stream', 'download'] as const

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const CACHE_CONTROL: Record<MediaVariant, string> = {
	thumb: 'private, max-age=86400, immutable',
	stream: 'private, max-age=60',
	download: 'private, max-age=0, no-store',
}

function isVariant(value: string): value is MediaVariant {
	return (VARIANTS as readonly string[]).includes(value)
}

function buildThumbUrl(code: string): string {
	return `https://eapi.pcloud.com/getpubthumb?code=${encodeURIComponent(code)}&size=640x640`
}

function defaultVariant(kind: CachedMedia['kind']): MediaVariant {
	return kind === 'video' ? 'stream' : 'thumb'
}

function asciiFallbackFilename(name: string): string {
	return name.replace(/[^\x20-\x21\x23-\x7e]/g, '')
}

function buildContentDisposition(name: string): string {
	const fallback = asciiFallbackFilename(name) || 'download'
	const utf8 = encodeURIComponent(name)
	return `attachment; filename="${fallback}"; filename*=UTF-8''${utf8}`
}

export type ResolveStreamUrl = (code: string) => Promise<string>

export type FetchBytes = (url: string, range: string | null) => Promise<Response>

export type MemoryRequestDeps = {
	loadServerUser: () => Promise<ServerUser | null>
	mediaCache: MediaCache
	resolveStreamUrl: ResolveStreamUrl
	fetchBytes: FetchBytes
}

async function streamFromUpstream(
	upstreamUrl: string,
	range: string | null,
	variant: MediaVariant,
	contenttype: string,
	fetchBytes: FetchBytes,
): Promise<Response> {
	const upstream = await fetchBytes(upstreamUrl, range)
	const headers = new Headers({
		'content-type': contenttype,
		'accept-ranges': 'bytes',
		'cache-control': CACHE_CONTROL[variant],
	})
	const contentLength = upstream.headers.get('content-length')
	if (contentLength) headers.set('content-length', contentLength)
	const contentRange = upstream.headers.get('content-range')
	if (contentRange) headers.set('content-range', contentRange)
	return new Response(upstream.body, { status: upstream.status, headers })
}

async function downloadFromUpstream(
	upstreamUrl: string,
	name: string,
	contenttype: string,
	fetchBytes: FetchBytes,
): Promise<Response> {
	// Range must not leak: a download must always deliver the full file. Forcing
	// status 200 also strips upstream `content-range` semantics that would
	// otherwise confuse the browser save dialog.
	const upstream = await fetchBytes(upstreamUrl, null)
	const headers = new Headers({
		'content-type': contenttype,
		'cache-control': CACHE_CONTROL.download,
		'content-disposition': buildContentDisposition(name),
	})
	const contentLength = upstream.headers.get('content-length')
	if (contentLength) headers.set('content-length', contentLength)
	return new Response(upstream.body, { status: 200, headers })
}

export async function handleMemoryRequest(
	request: Request,
	uuid: string,
	deps: MemoryRequestDeps,
): Promise<Response> {
	const user = await deps.loadServerUser()
	if (!user) return new Response('unauthorized', { status: 401 })

	if (!UUID_V4.test(uuid)) return new Response('invalid uuid', { status: 400 })

	const variantParam = new URL(request.url).searchParams.get('variant')
	if (variantParam !== null && !isVariant(variantParam)) {
		return new Response('invalid variant', { status: 400 })
	}

	const meta = await deps.mediaCache.lookup(uuid)
	if (!meta) return new Response('not found', { status: 404 })

	const variant: MediaVariant = variantParam ?? defaultVariant(meta.kind)

	try {
		// Byte-stream the bytes through the function so the public-link URL
		// (and `code`) never reach the browser via a Location header. Public
		// links aren't IP-bound, so the function-side fetch works even though
		// the URL was minted on a different IP than the request.
		if (variant === 'thumb') {
			return await streamFromUpstream(
				buildThumbUrl(meta.code),
				request.headers.get('range'),
				'thumb',
				meta.contenttype,
				deps.fetchBytes,
			)
		}
		if (variant === 'stream') {
			return await streamFromUpstream(
				await deps.resolveStreamUrl(meta.code),
				request.headers.get('range'),
				'stream',
				meta.contenttype,
				deps.fetchBytes,
			)
		}
		return await downloadFromUpstream(
			await deps.resolveStreamUrl(meta.code),
			meta.name,
			meta.contenttype,
			deps.fetchBytes,
		)
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown error'
		return new Response(`pCloud error: ${message}`, { status: 502 })
	}
}
