import type { MediaVariant } from '#/lib/media-proxy.server'
import type { Client } from 'pcloud-kit'

import { resolveMediaUrl } from '#/lib/media-proxy.server'
import { createFileRoute } from '@tanstack/react-router'
import { createClient } from 'pcloud-kit'

const VARIANTS = ['image', 'stream', 'poster'] as const satisfies readonly MediaVariant[]

function isVariant(value: string): value is MediaVariant {
	return (VARIANTS as readonly string[]).includes(value)
}

export const Route = createFileRoute('/api/media/$fileid')({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const fileidRaw = (params as { fileid: string }).fileid
				const fileid = Number(fileidRaw)
				if (!Number.isInteger(fileid) || fileid <= 0) {
					return new Response('invalid fileid', { status: 400 })
				}

				const url = new URL(request.url)
				const variantParam = url.searchParams.get('variant')
				if (variantParam !== null && !isVariant(variantParam)) {
					return new Response('invalid variant', { status: 400 })
				}

				try {
					const token = process.env.PCLOUD_TOKEN
					if (!token) throw new Error('PCLOUD_TOKEN is not set')
					const client: Client = createClient({ token, type: 'pcloud' })

					// Slice A: stat to determine kind + contenttype. Slice B replaces with a cache lookup.
					const stat = await client.call<{ metadata: { contenttype: string } }>('stat', {
						fileid,
					})
					const contenttype = stat.metadata.contenttype
					const isVideo = contenttype.startsWith('video/')
					const variant: MediaVariant = variantParam ?? (isVideo ? 'stream' : 'image')

					const target = await resolveMediaUrl(client, fileid, variant, contenttype)
					return new Response(null, { status: 302, headers: { Location: target } })
				} catch (err) {
					const message = err instanceof Error ? err.message : 'unknown error'
					return new Response(`pCloud error: ${message}`, { status: 502 })
				}
			},
		},
	},
})
