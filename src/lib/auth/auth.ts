import { createServerFn } from '@tanstack/react-start'

import type { ServerUser } from './auth.server'

export type { ServerUser }

export const getServerUser = createServerFn({ method: 'GET' }).handler(async () => {
	const { loadServerUser } = await import('./auth.server')
	return loadServerUser()
})
