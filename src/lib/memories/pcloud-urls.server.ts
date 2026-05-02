import type { Client } from 'pcloud-kit'

// pcloud-kit's callRaw throws PcloudApiError automatically on result !== 0,
// so the helpers below only need to handle the "success but no hosts in the
// response" edge case explicitly.

export type ThumbSize = '640x640' | '1025x1025'

type PublinkLink = {
	hosts: readonly string[]
	path: string
}

function buildUrl(res: PublinkLink, method: string): string {
	const host = res.hosts[0]
	if (!host) throw new TypeError(`${method}: no hosts returned`)
	return `https://${host}${res.path}`
}

export async function resolveThumbUrl(
	client: Client,
	code: string,
	size: ThumbSize,
): Promise<string> {
	const res = await client.callRaw<PublinkLink>('getpubthumblink', { code, size })
	return buildUrl(res, 'getpubthumblink')
}

export async function resolveMediaUrl(client: Client, code: string): Promise<string> {
	const res = await client.callRaw<PublinkLink>('getpublinkdownload', { code })
	return buildUrl(res, 'getpublinkdownload')
}
