import type { Client } from 'pcloud-kit'

export type MediaVariant = 'image' | 'stream' | 'poster'

type LinkResponse = { hosts: readonly string[]; path: string }

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
