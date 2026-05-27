import type { FolderCache } from '../cache/folder-cache'
import type { CachedMedia, MediaCache } from '../cache/media-cache'
import type { AdminFileItem } from './collection.server'

import { buildThumbUrl } from '../memories/pcloud-urls.server'

function kindFromCached(meta: CachedMedia): 'image' | 'video' | 'other' {
	if (meta.kind === 'image') return 'image'
	if (meta.kind === 'video') return 'video'
	return 'other'
}

export async function fetchAdminFolderMedia(
	folder: FolderCache,
	media: MediaCache,
): Promise<AdminFileItem[]> {
	const snap = await folder.lookup()
	if (!snap || snap.uuids.length === 0) return []

	const metas = await Promise.all(snap.uuids.map((uuid) => media.lookup(uuid)))
	const items: AdminFileItem[] = []
	for (let i = 0; i < snap.uuids.length; i++) {
		const uuid = snap.uuids[i]!
		const meta = metas[i]
		if (!meta) continue
		items.push({
			uuid,
			name: meta.name,
			kind: kindFromCached(meta),
			thumbUrl: buildThumbUrl(meta.code, '320x320'),
		})
	}
	return items
}
