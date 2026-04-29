import type { Client } from 'pcloud-kit'
import type { ReactNode } from 'react'

import { createClient } from 'pcloud-kit'
import { createContext, useContext, useEffect, useState } from 'react'

import type { MemoryItem } from './pcloud.server'

type LinkResponse = { hosts: readonly string[]; path: string }

type MemoryUrls = { url: string; posterUrl?: string }

const PcloudClientContext = createContext<Client | null>(null)

export function PcloudClientProvider({ token, children }: { token: string; children: ReactNode }) {
	// Owned state, not a derived value: lazy-init once per provider lifetime.
	// Token rotation isn't handled mid-session — a hard reload re-mounts the
	// provider and picks up the new token from the next loader response.
	const [client] = useState<Client>(() => createClient({ token, type: 'pcloud' }))
	return <PcloudClientContext value={client}>{children}</PcloudClientContext>
}

export function usePcloudClient(): Client {
	const client = useContext(PcloudClientContext)
	if (!client) throw new Error('usePcloudClient must be used within PcloudClientProvider')
	return client
}

async function getThumbUrl(client: Client, fileid: number): Promise<string> {
	const res = await client.call<LinkResponse>('getthumblink', { fileid, size: '2048x1024' })
	const host = res.hosts[0]
	if (!host) throw new TypeError('getthumblink: no hosts returned')
	return `https://${host}${res.path}`
}

async function getStreamUrl(client: Client, fileid: number): Promise<string> {
	return client.getfilelink(fileid)
}

export function useMemoryUrls(item: MemoryItem): MemoryUrls | undefined {
	const client = usePcloudClient()
	const [urls, setUrls] = useState<MemoryUrls | undefined>(undefined)

	useEffect(() => {
		let cancelled = false
		async function resolve() {
			if (item.kind === 'image') {
				const url = await getThumbUrl(client, item.fileid)
				if (!cancelled) setUrls({ url })
			} else {
				const [url, posterUrl] = await Promise.all([
					getStreamUrl(client, item.fileid),
					getThumbUrl(client, item.fileid),
				])
				if (!cancelled) setUrls({ url, posterUrl })
			}
		}
		void resolve()
		return () => {
			cancelled = true
		}
	}, [client, item.fileid, item.kind])

	return urls
}
