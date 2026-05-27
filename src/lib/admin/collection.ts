import { createServerFn } from '@tanstack/react-start'

import type { AdminFileItem } from './collection.server'

export type { AdminFileItem }

export type CollectionMediaResult =
	| { status: 'ok'; items: AdminFileItem[] }
	| { status: 'unconfigured' }

type FileidsInput = { fileids: readonly number[] }

function parseFileidsInput(input: unknown): FileidsInput | null {
	if (!input || typeof input !== 'object') return null
	const obj = input as Record<string, unknown>
	if (!Array.isArray(obj.fileids)) return null
	if (obj.fileids.length === 0) return null
	if (!obj.fileids.every((f): f is number => Number.isInteger(f) && (f as number) > 0)) return null
	return { fileids: obj.fileids as readonly number[] }
}

async function gateAdmin(): Promise<void> {
	const { loadServerUser } = await import('../auth/auth.server')
	const user = await loadServerUser()
	if (!user) throw new Error('unauthenticated')
	if (!user.isAdmin) throw new Error('forbidden')
}

async function makeClient() {
	const token = process.env.PCLOUD_ADMIN_AUTH
	if (!token) throw new Error('PCLOUD_ADMIN_AUTH is not set')
	const { createClient } = await import('pcloud-kit')
	return createClient({ token, type: 'pcloud' })
}

export const getCollectionMedia = createServerFn({ method: 'GET' }).handler(
	async (): Promise<CollectionMediaResult> => {
		await gateAdmin()
		const { CollectionIdMissingError, fetchCollectionMedia } = await import('./collection.server')
		try {
			const client = await makeClient()
			const items = await fetchCollectionMedia(client)
			return { status: 'ok', items }
		} catch (e) {
			if (e instanceof CollectionIdMissingError) return { status: 'unconfigured' }
			throw e
		}
	},
)

export const linkFilesToCollection = createServerFn({ method: 'POST' })
	.inputValidator((input: unknown): FileidsInput | null => parseFileidsInput(input))
	.handler(async ({ data }): Promise<void> => {
		if (!data) throw new Error('invalid input')
		await gateAdmin()
		const client = await makeClient()
		const { linkFilesToCollectionRaw } = await import('./collection.server')
		await linkFilesToCollectionRaw(client, data.fileids)
	})

export const unlinkFilesFromCollection = createServerFn({ method: 'POST' })
	.inputValidator((input: unknown): FileidsInput | null => parseFileidsInput(input))
	.handler(async ({ data }): Promise<void> => {
		if (!data) throw new Error('invalid input')
		await gateAdmin()
		const client = await makeClient()
		const { unlinkFilesFromCollectionRaw } = await import('./collection.server')
		await unlinkFilesFromCollectionRaw(client, data.fileids)
	})
