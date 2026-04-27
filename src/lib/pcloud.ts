import { createServerFn } from '@tanstack/react-start'

import type { MemoryImage } from './pcloud.server'

export const getTodayMemoryImage = createServerFn({ method: 'GET' }).handler(
	async (): Promise<MemoryImage | null> => {
		const { fetchTodayMemoryImage } = await import('./pcloud.server')
		const now = new Date()
		return fetchTodayMemoryImage({ month: now.getMonth() + 1, day: now.getDate() })
	},
)

export const getRandomMemoryImage = createServerFn({ method: 'GET' }).handler(
	async (): Promise<MemoryImage | null> => {
		const { fetchRandomMemoryImage } = await import('./pcloud.server')
		return fetchRandomMemoryImage()
	},
)
