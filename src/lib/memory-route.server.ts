import type { ServerUser } from './auth.server'
import type { CachedMedia, MediaCache } from './media-cache'

export type MediaVariant = 'image' | 'stream' | 'poster'

const VARIANTS: readonly MediaVariant[] = ['image', 'stream', 'poster'] as const

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const CACHE_CONTROL: Record<MediaVariant, string> = {
	image: 'private, max-age=86400, immutable',
	poster: 'private, max-age=86400, immutable',
	stream: 'private, max-age=60',
}

function isVariant(value: string): value is MediaVariant {
	return (VARIANTS as readonly string[]).includes(value)
}

function buildThumbUrl(code: string): string {
	return `https://eapi.pcloud.com/getpubthumb?code=${encodeURIComponent(code)}&size=2048x1024`
}

function defaultVariant(kind: CachedMedia['kind']): MediaVariant {
	return kind === 'video' ? 'stream' : 'image'
}

export type ResolveStreamUrl = (code: string) => Promise<string>

export type MemoryRequestDeps = {
	loadServerUser: () => Promise<ServerUser | null>
	mediaCache: MediaCache
	resolveStreamUrl: ResolveStreamUrl
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
		const target =
			variant === 'stream' ? await deps.resolveStreamUrl(meta.code) : buildThumbUrl(meta.code)
		return new Response(null, {
			status: 302,
			headers: {
				location: target,
				'cache-control': CACHE_CONTROL[variant],
			},
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown error'
		return new Response(`pCloud error: ${message}`, { status: 502 })
	}
}
