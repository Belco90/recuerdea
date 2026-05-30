import { handleAdminThumbRequest } from '#/lib/admin/thumb-proxy.server'
import { loadServerUser } from '#/lib/auth/auth.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/admin/thumb/$fileid')({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const fileid = (params as { fileid: string }).fileid
				return handleAdminThumbRequest(fileid, {
					loadServerUser,
					makeClient: async () => {
						const token = process.env.PCLOUD_TOKEN
						if (!token) throw new Error('PCLOUD_TOKEN is not set')
						const { createClient } = await import('pcloud-kit')
						return createClient({ token })
					},
					fetchBytes: (url) => fetch(url),
				})
			},
		},
	},
})
