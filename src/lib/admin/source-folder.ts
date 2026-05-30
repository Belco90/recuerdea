import { createServerFn } from '@tanstack/react-start'

import type { AdminFolderListing, SourceFileItem } from './source-folder.server'

export type { AdminFolderListing, SourceFileItem }

export type AdminSourceFolderResult =
	| { status: 'ok'; listing: AdminFolderListing }
	| { status: 'source-folder-id-missing' }
	| { status: 'folder-not-permitted' }

type FolderidInput = { folderid?: number }

function parseFolderidInput(input: unknown): FolderidInput {
	if (!input || typeof input !== 'object') return {}
	const obj = input as Record<string, unknown>
	const raw = obj.folderid
	if (raw === undefined || raw === null) return {}
	if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return { folderid: raw }
	return {}
}

async function gateAdmin(): Promise<void> {
	const { loadServerUser } = await import('../auth/auth.server')
	const user = await loadServerUser()
	if (!user) throw new Error('unauthenticated')
	if (!user.isAdmin) throw new Error('forbidden')
}

async function makeClient() {
	const token = process.env.PCLOUD_TOKEN
	if (!token) throw new Error('PCLOUD_TOKEN is not set')
	const { createClient } = await import('pcloud-kit')
	return createClient({ token })
}

export const getAdminSourceFolder = createServerFn({ method: 'GET' })
	.inputValidator((input: unknown): FolderidInput => parseFolderidInput(input))
	.handler(async ({ data }): Promise<AdminSourceFolderResult> => {
		await gateAdmin()
		const { FolderNotPermittedError, SourceFolderIdMissingError, fetchAdminSourceFolder } =
			await import('./source-folder.server')
		try {
			const client = await makeClient()
			const listing = await fetchAdminSourceFolder(client, { folderid: data.folderid })
			return { status: 'ok', listing }
		} catch (e) {
			if (e instanceof SourceFolderIdMissingError) return { status: 'source-folder-id-missing' }
			if (e instanceof FolderNotPermittedError) return { status: 'folder-not-permitted' }
			throw e
		}
	})
