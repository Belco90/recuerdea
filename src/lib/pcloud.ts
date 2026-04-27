import { createServerFn } from '@tanstack/react-start'

import type { MemoryImage } from './pcloud.server'

type DateOverride = { month: number; day: number }

function parseOverrideInput(input: unknown): DateOverride | null {
	if (!input || typeof input !== 'object') return null
	const obj = input as Record<string, unknown>
	const month = Number(obj.month)
	const day = Number(obj.day)
	if (!Number.isInteger(month) || month < 1 || month > 12) return null
	if (!Number.isInteger(day) || day < 1 || day > 31) return null
	return { month, day }
}

function realToday(): DateOverride {
	const now = new Date()
	return { month: now.getMonth() + 1, day: now.getDate() }
}

export const getTodayMemoryImage = createServerFn({ method: 'GET' })
	.inputValidator((input: unknown): DateOverride | null => parseOverrideInput(input))
	.handler(async ({ data }): Promise<MemoryImage | null> => {
		const { fetchTodayMemoryImage } = await import('./pcloud.server')
		let target = realToday()
		if (data) {
			const { loadServerUser } = await import('./auth.server')
			const user = await loadServerUser()
			if (user?.isAdmin) target = data
		}
		return fetchTodayMemoryImage(target)
	})

export const getRandomMemoryImage = createServerFn({ method: 'GET' }).handler(
	async (): Promise<MemoryImage | null> => {
		const { fetchRandomMemoryImage } = await import('./pcloud.server')
		return fetchRandomMemoryImage()
	},
)
