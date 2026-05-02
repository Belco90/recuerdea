import type { Client } from 'pcloud-kit'

// `getpubthumblink` returns CDN URLs that are signed against the calling IP —
// they break when the browser fetches them from a different IP. Stick with the
// stateless `getpubthumb?code=…&size=…` endpoint instead: pCloud serves bytes
// directly there, no per-request signing, no IP binding. Trade-off: the
// per-file public-link `code` reaches the browser via the URL (acknowledged
// in SPEC §7).
//
// `getpublinkdownload` (used for video stream + downloads) is in the same
// host+signed-path family as `getpubthumblink` and may carry the same
// IP-binding semantics — confirm via deploy-preview smoke (play a video,
// click download). If it fails the same way, the fallback is to restore the
// proxy for these two paths only; there is no stateless direct-bytes
// equivalent for full files.
//
// pcloud-kit's callRaw throws PcloudApiError automatically on `result !== 0`,
// so resolveMediaUrl only handles the "success but empty hosts" edge case.

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
