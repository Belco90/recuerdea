// Authenticated proxy for source-folder thumbnails. The browser hits
// `/api/admin/thumb/<fileid>` and this handler mints an IP-bound
// `getthumblink` URL server-side, fetches the bytes from the same SSR
// (whose IP matches the signed URL), and pipes them back as image/jpeg.
//
// We can't ship `getthumblink` / `getthumbslinks` URLs directly to the
// browser: pCloud signs them against the calling function's IP and
// rejects browser-origin fetches with 410 "another IP address" (see SPEC
// §17). The home page sidesteps this by using public-link thumbnails
// (`getpubthumb?code=…`), but the source-folder navigator can't — most
// files there haven't been linked yet, so they have no public `code`.

import type { Client } from 'pcloud-kit'

import type { ServerUser } from '../auth/auth.server'

export type ThumbProxyDeps = {
	loadServerUser: () => Promise<ServerUser | null>
	makeClient: () => Promise<Client>
	fetchBytes: (url: string) => Promise<Response>
}

type ThumbLinkResponse = { hosts: readonly string[]; path: string }

export async function handleAdminThumbRequest(
	rawFileid: string,
	deps: ThumbProxyDeps,
): Promise<Response> {
	const user = await deps.loadServerUser()
	if (!user) return new Response('unauthorized', { status: 401 })
	if (!user.isAdmin) return new Response('forbidden', { status: 403 })

	const fileid = Number(rawFileid)
	if (!Number.isInteger(fileid) || fileid < 0) {
		return new Response('invalid fileid', { status: 400 })
	}

	try {
		const client = await deps.makeClient()
		const link = await client.call<ThumbLinkResponse>('getthumblink', {
			fileid,
			type: 'jpg',
			size: '320x320',
			crop: 1,
		})
		const host = link.hosts[0]
		if (!host) return new Response('no thumb host', { status: 502 })

		const upstream = await deps.fetchBytes(`https://${host}${link.path}`)
		if (!upstream.ok) {
			return new Response(`upstream ${upstream.status}`, { status: 502 })
		}
		return new Response(upstream.body, {
			status: 200,
			headers: {
				'content-type': 'image/jpeg',
				// Browser-side cache keeps the navigator responsive while folder
				// browsing; private so intermediates don't fan-out admin thumbs.
				'cache-control': 'private, max-age=300',
			},
		})
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'unknown error'
		return new Response(`pCloud error: ${msg}`, { status: 502 })
	}
}
