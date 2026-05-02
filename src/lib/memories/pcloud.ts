import { createServerFn } from '@tanstack/react-start'

import type { MemoryItem } from './pcloud.server'

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

export const getTodayMemories = createServerFn({ method: 'GET' })
	.inputValidator((input: unknown): DateOverride | null => parseOverrideInput(input))
	.handler(async ({ data }): Promise<MemoryItem[]> => {
		// Hard auth gate — every API endpoint in this app requires authentication.
		const { loadServerUser } = await import('../auth/auth.server')
		const user = await loadServerUser()
		if (!user) throw new Error('unauthenticated')

		const target = data && user.isAdmin ? data : realToday()

		const token = process.env.PCLOUD_TOKEN
		if (!token) {
			// eslint-disable-next-line no-console
			console.warn('[pcloud] PCLOUD_TOKEN not set — returning empty memories')
			return []
		}

		const { createClient } = await import('pcloud-kit')
		const { fetchTodayMemories } = await import('./pcloud.server')
		return fetchTodayMemories(target, createClient({ token }))
	})
