import type { Client } from 'pcloud-kit'

export type MediaVariant = 'image' | 'stream' | 'poster'

type LinkResponse = { hosts: readonly string[]; path: string }

const CACHE_CONTROL: Record<MediaVariant, string> = {
	// 1-day TTL on thumbnails. `immutable` is intentionally omitted in slice A.5
	// because the URL is keyed by `fileid` (not content hash) — slice B's switch
	// to uuid-keyed URLs makes immutable safe.
	image: 'public, max-age=86400',
	poster: 'public, max-age=86400',
	// Shorter TTL for the streaming response so a replaced video propagates fast.
	stream: 'public, max-age=600',
}

export async function resolveMediaUrl(
	client: Client,
	fileid: number,
	variant: MediaVariant,
	contenttype: string,
): Promise<string> {
	const { method, params } =
		variant === 'stream'
			? { method: 'getfilelink' as const, params: { fileid, contenttype } }
			: { method: 'getthumblink' as const, params: { fileid, size: '2048x1024' } }

	const res = await client.call<LinkResponse>(method, params)
	const host = res.hosts[0]
	if (!host) throw new TypeError(`${method}: no hosts returned`)
	return `https://${host}${res.path}`
}

export async function streamMedia(
	client: Client,
	fileid: number,
	variant: MediaVariant,
	contenttype: string,
	rangeHeader: string | null,
): Promise<Response> {
	const upstreamUrl = await resolveMediaUrl(client, fileid, variant, contenttype)
	const upstreamHeaders = new Headers()
	if (rangeHeader) upstreamHeaders.set('range', rangeHeader)
	const upstream = await fetch(upstreamUrl, { headers: upstreamHeaders })

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
