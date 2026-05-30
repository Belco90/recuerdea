import type { Client, FileMetadata, FolderMetadata } from 'pcloud-kit'

export type SourceFileItem = {
	fileid: number
	name: string
	kind: 'image' | 'video' | 'other'
	thumbUrl: string
	// pCloud `file.created`, normalized to an ISO instant (or null when absent /
	// unparseable). Same source the collection uses for `captureDate`. Carried to
	// the browser so the picker can filter the media grid by day.
	created: string | null
}

export type AdminFolderListing = {
	folderid: number
	name: string
	breadcrumbs: ReadonlyArray<{ folderid: number; name: string }>
	subfolders: ReadonlyArray<{ folderid: number; name: string }>
	files: ReadonlyArray<SourceFileItem>
}

export class SourceFolderIdMissingError extends Error {
	readonly tag = 'source-folder-id-missing' as const
	constructor() {
		super('PCLOUD_SOURCE_FOLDER_ID is not set')
	}
}

export class FolderNotPermittedError extends Error {
	readonly tag = 'folder-not-permitted' as const
	constructor(folderid: number) {
		super(`folder ${folderid} is outside the source root`)
	}
}

export function assertSourceFolderId(): number {
	const raw = process.env.PCLOUD_SOURCE_FOLDER_ID
	if (!raw) throw new SourceFolderIdMissingError()
	const id = Number(raw)
	if (!Number.isInteger(id)) throw new TypeError('PCLOUD_SOURCE_FOLDER_ID must be an integer')
	return id
}

const ROOT_LABEL = 'Raíz'
const MAX_BREADCRUMB_DEPTH = 10

type ListfolderResponse = { metadata: FolderMetadata }

function kindFromContenttype(ct: string): 'image' | 'video' | 'other' {
	if (ct.startsWith('image/')) return 'image'
	if (ct.startsWith('video/')) return 'video'
	return 'other'
}

function isMediaFile(file: FileMetadata): boolean {
	return file.contenttype.startsWith('image/') || file.contenttype.startsWith('video/')
}

// Mirrors `parseCapturedDate` in collection.server.ts: pCloud returns dates as
// RFC-2822-ish strings (e.g. "Mon, 15 Apr 2024 10:00:00 +0000"); normalize to
// an ISO instant, or null when unparseable.
function toIso(raw: string): string | null {
	const ms = Date.parse(raw)
	return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

async function buildBreadcrumbs(
	client: Client,
	current: FolderMetadata,
	sourceRoot: number,
): Promise<Array<{ folderid: number; name: string }>> {
	if (current.folderid === sourceRoot) {
		return [{ folderid: sourceRoot, name: ROOT_LABEL }]
	}
	const crumbs: Array<{ folderid: number; name: string }> = [
		{ folderid: current.folderid, name: current.name },
	]
	let cursor = current.parentfolderid
	let depth = 0
	// Stop at pCloud root (folderid 0) — if we reach it and it isn't our
	// source root, the target is outside the supervised tree.
	while (
		cursor !== undefined &&
		cursor !== 0 &&
		cursor !== sourceRoot &&
		depth < MAX_BREADCRUMB_DEPTH
	) {
		// Sequential by necessity: each ancestor's id comes from the prior response.
		// eslint-disable-next-line no-await-in-loop
		const res = await client.call<ListfolderResponse>('listfolder', {
			folderid: cursor,
			nofiles: 1,
			noshares: 1,
		})
		crumbs.unshift({ folderid: cursor, name: res.metadata.name })
		cursor = res.metadata.parentfolderid
		depth++
	}
	if (cursor !== sourceRoot) {
		throw new FolderNotPermittedError(current.folderid)
	}
	crumbs.unshift({ folderid: sourceRoot, name: ROOT_LABEL })
	return crumbs
}

// Thumbnails route through `/api/admin/thumb/<fileid>` because pCloud's
// `getthumblink` / `getthumbslinks` URLs are IP-bound (SPEC §17): the SSR
// can mint them but the browser's IP won't match, so it can't fetch them
// directly.
function buildFiles(files: readonly FileMetadata[]): SourceFileItem[] {
	return files.map((f) => ({
		fileid: f.fileid,
		name: f.name,
		kind: kindFromContenttype(f.contenttype),
		thumbUrl: `/api/admin/thumb/${f.fileid}`,
		created: toIso(f.created),
	}))
}

export async function fetchAdminSourceFolder(
	client: Client,
	opts: { folderid?: number } = {},
): Promise<AdminFolderListing> {
	const sourceRoot = assertSourceFolderId()
	const target = opts.folderid ?? sourceRoot

	const currentRes = await client.call<ListfolderResponse>('listfolder', {
		folderid: target,
		noshares: 1,
	})
	const current = currentRes.metadata

	const breadcrumbs = await buildBreadcrumbs(client, current, sourceRoot)

	const contents = current.contents ?? []
	const subfolders: Array<{ folderid: number; name: string }> = []
	const mediaFiles: FileMetadata[] = []
	for (const item of contents) {
		if (item.isfolder) {
			subfolders.push({ folderid: item.folderid, name: item.name })
		} else if (isMediaFile(item)) {
			mediaFiles.push(item)
		}
	}

	const files = buildFiles(mediaFiles)

	return {
		folderid: target,
		name: target === sourceRoot ? ROOT_LABEL : current.name,
		breadcrumbs,
		subfolders,
		files,
	}
}
