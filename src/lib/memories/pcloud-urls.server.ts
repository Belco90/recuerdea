import type { Client } from 'pcloud-kit'

// All three helpers below resolve pCloud URLs that we ship straight to the
// browser. The trade-off in each case:
//
// - `buildThumbUrl` builds a stateless `getpubthumb?code=…&size=…` URL. No
//   API call, no per-request signing, no IP binding. Per-file public-link
//   `code` reaches the browser via the URL — acknowledged in SPEC §7.
//
// - `resolveMediaUrl` (`getpublinkdownload`) returns a signed CDN URL. The
//   browser must fetch it shortly after resolution; works for the
//   immediate-consumption download path (server-fn → fetch → blob → save).
//
// - `resolvePubVideoUrl` (`getpubvideolinks`) returns a public-link CDN URL
//   for a pre-transcoded H.264 variant. Used as `<video src>`.
//
// pcloud-kit's callRaw throws PcloudApiError automatically on `result !== 0`,
// so the helpers only handle the "success but empty hosts" edge case.

export type ThumbSize = '320x320' | '640x640' | '1025x1025'

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
