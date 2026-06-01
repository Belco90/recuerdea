import { createServerFn } from '@tanstack/react-start'

import type { AdminFolderListing, SourceDayMedia, SourceFileItem } from './source-folder.server'

export type { AdminFolderListing, SourceDayMedia, SourceFileItem }

export type AdminSourceFolderResult =
	| { status: 'ok'; listing: AdminFolderListing }
	| { status: 'source-folder-id-missing' }
	| { status: 'folder-not-permitted' }

export type AdminSourceDayResult =
	| { status: 'ok'; day: SourceDayMedia }
	| { status: 'source-folder-id-missing' }

type FolderidInput = { folderid?: number }

type DayInput = { which: 'today' | 'tomorrow' }

function parseDayInput(input: unknown): DayInput {
	if (!input || typeof input !== 'object') return { which: 'today' }
	const raw = (input as Record<string, unknown>).which
	return { which: raw === 'tomorrow' ? 'tomorrow' : 'today' }
}

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

export const getAdminSourceDayMedia = createServerFn({ method: 'GET' })
	.inputValidator((input: unknown): DayInput => parseDayInput(input))
	.handler(async ({ data }): Promise<AdminSourceDayResult> => {
		await gateAdmin()
		const { SourceFolderIdMissingError, fetchAdminSourceDayMedia } =
			await import('./source-folder.server')
		try {
			const client = await makeClient()
			const day = await fetchAdminSourceDayMedia(client, { which: data.which })
			return { status: 'ok', day }
		} catch (e) {
			if (e instanceof SourceFolderIdMissingError) return { status: 'source-folder-id-missing' }
			throw e
		}
	})
