import { createServerFn } from '@tanstack/react-start'

import type { MemoryItem } from './pcloud.server'

export type LoaderPayload = { items: readonly MemoryItem[]; pcloudToken: string }

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
	.handler(async ({ data }): Promise<LoaderPayload> => {
		// Hard auth gate — the response includes the pCloud token, so unauthenticated
		// callers must never reach this branch even though the route's `beforeLoad`
		// already redirects them.
		const { loadServerUser } = await import('./auth.server')
		const user = await loadServerUser()
		if (!user) throw new Error('unauthenticated')

		const target = data && user.isAdmin ? data : realToday()

		const pcloudToken = process.env.PCLOUD_TOKEN
		if (!pcloudToken) throw new Error('PCLOUD_TOKEN is not set')

		const { fetchTodayMemories } = await import('./pcloud.server')
		const items = await fetchTodayMemories(target)
		return { items, pcloudToken }
	})
