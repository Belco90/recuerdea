import { type FileMetadata, createClient } from 'pcloud-kit'

export type MemoryImage = { url: string; name: string }

type GetThumbLinkResponse = { hosts: string[]; path: string }

export async function fetchFirstMemoryImage(): Promise<MemoryImage | null> {
	const token = process.env.PCLOUD_TOKEN
	const folderIdRaw = process.env.PCLOUD_MEMORIES_FOLDER_ID
	if (!token) throw new Error('PCLOUD_TOKEN is not set')
	if (!folderIdRaw) throw new Error('PCLOUD_MEMORIES_FOLDER_ID is not set')

	const folderId = Number(folderIdRaw)
	if (!Number.isInteger(folderId)) {
		throw new Error('PCLOUD_MEMORIES_FOLDER_ID must be an integer')
	}

	const client = createClient({ token, type: 'pcloud' })
	const folder = await client.listfolder(folderId)
	const firstImage = folder.contents?.find(
		(item): item is FileMetadata => !item.isfolder && item.contenttype.startsWith('image/'),
	)
	if (!firstImage) return null

	const thumb = await client.call<GetThumbLinkResponse>('getthumblink', {
		fileid: firstImage.fileid,
		size: '2048x1024',
	})
	const url = `https://${thumb.hosts[0]}${thumb.path}`
	return { url, name: firstImage.name }
}
