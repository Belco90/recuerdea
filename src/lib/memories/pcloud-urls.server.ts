import type { Client } from 'pcloud-kit'

// `getpubthumblink` returns CDN URLs that are signed against the calling IP —
// they break when the browser fetches them from a different IP. Stick with the
// stateless `getpubthumb?code=…&size=…` endpoint instead: pCloud serves bytes
// directly there, no per-request signing, no IP binding. Trade-off: the
// per-file public-link `code` reaches the browser via the URL (acknowledged
// in SPEC §7).
//
// `resolveMediaUrl` (`getpublinkdownload`) and `resolveVideoLink`
// (`getvideolink`) both return IP-bound CDN URLs. `getpublinkdownload` URLs
// for images survive the trip to the browser as long as the browser fetches
// them right after resolution (used by the lightbox download button). Video
// URLs go through the `/api/video/<uuid>` proxy because `<video src>` may be
// fetched minutes after page render — see video-stream.server.ts.
//
// pcloud-kit's callRaw throws PcloudApiError automatically on `result !== 0`,
// so the helpers only handle the "success but empty hosts" edge case.

export type ThumbSize = '640x640' | '1025x1025'

type PublinkLink = {
	hosts: readonly string[]
	path: string
}

export function buildThumbUrl(code: string, size: ThumbSize): string {
	return `https://eapi.pcloud.com/getpubthumb?code=${encodeURIComponent(code)}&size=${size}`
}

export async function resolveMediaUrl(client: Client, code: string): Promise<string> {
	const res = await client.callRaw<PublinkLink>('getpublinkdownload', { code })
	const host = res.hosts[0]
	if (!host) throw new TypeError('getpublinkdownload: no hosts returned')
	return `https://${host}${res.path}`
}

export type VideoLinkOpts = {
	contenttype?: string
	forcedownload?: boolean
}

// Resolves a `getvideolink` CDN URL for the given fileid. Like the other
// signed-link endpoints in pCloud's API, the returned URL is IP-bound — only
// safe to fetch from the same host that resolved it. Pass `contenttype` to
// have pCloud serve the response with that MIME, or `forcedownload: true` to
// have pCloud emit `Content-Disposition: attachment` upstream. The proxy at
// `/api/video/<uuid>` overrides both headers itself, so these args are mostly
// to align pCloud's behavior with what we're going to ship to the browser.
export async function resolveVideoLink(
	client: Client,
	fileid: number,
	opts: VideoLinkOpts,
): Promise<string> {
	const params: Record<string, string | number | boolean> = { fileid }
	if (opts.contenttype !== undefined) params.contenttype = opts.contenttype
	if (opts.forcedownload === true) params.forcedownload = 1

	const res = await client.callRaw<PublinkLink>('getvideolink', params)
	const host = res.hosts[0]
	if (!host) throw new TypeError('getvideolink: no hosts returned')
	return `https://${host}${res.path}`
}

type PubVideoVariant = {
	isoriginal?: boolean
	videocodec?: string
	audiocodec?: string
	width?: number
	height?: number
	hosts: readonly string[]
	path: string
}

type PubVideoLinksResponse = { variants: readonly PubVideoVariant[] }

// Resolves a browser-playable video URL via `getpubvideolinks`, the
// public-link variant of pCloud's video-streaming API. Returns multiple
// pre-transcoded variants tied to the public-link `code`. We pick a non-
// original H.264 variant (universally playable in Safari macOS + Chrome
// Android), or fall back to any H.264, or finally the first variant.
//
// Unlike `getvideolink` (auth, IP-bound) the returned CDN URL is meant to
// be consumed by anyone with the public-link `code`, so it should survive
// the trip to the browser. Smoke this on a deploy preview before relying
// on it for `<video src>` (which holds the URL across user idle time).
export async function resolvePubVideoUrl(client: Client, code: string): Promise<string> {
	const res = await client.callRaw<PubVideoLinksResponse>('getpubvideolinks', { code })
	const largestTranscoded = res.variants.reduce<PubVideoVariant | null>(
		(best, v) =>
			!v.isoriginal &&
			v.videocodec === 'h264' &&
			(best === null || variantArea(v) > variantArea(best))
				? v
				: best,
		null,
	)
	const picked =
		largestTranscoded ?? res.variants.find((v) => v.videocodec === 'h264') ?? res.variants[0]
	if (!picked) throw new TypeError('getpubvideolinks: no variants returned')
	const host = picked.hosts[0]
	if (!host) throw new TypeError('getpubvideolinks: no hosts on variant')
	return `https://${host}${picked.path}`
}

function variantArea(v: PubVideoVariant): number {
	return (v.width ?? 0) * (v.height ?? 0)
}
