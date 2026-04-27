import { createServerFn } from '@tanstack/react-start'

import type { MemoryImage } from './pcloud.server'

export const getFirstMemoryImage = createServerFn({ method: 'GET' }).handler(
	async (): Promise<MemoryImage | null> => {
		const { fetchFirstMemoryImage } = await import('./pcloud.server')
		return fetchFirstMemoryImage()
	},
)
