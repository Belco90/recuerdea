import type { MemoryItem } from '#/lib/pcloud.server'

import { AdminDateOverride } from '#/components/AdminDateOverride'
import { MemoryView } from '#/components/MemoryView'
import { getServerUser } from '#/lib/auth'
import { formatCaptureDate } from '#/lib/date'
import { useIdentity } from '#/lib/identity-context'
import { getTodayMemories } from '#/lib/pcloud'
import { Box, Button, Heading, Stack, Text } from '@chakra-ui/react'
import { createFileRoute, redirect } from '@tanstack/react-router'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type HomeSearch = { date?: string }

function parseSearchDate(date: unknown): string | undefined {
	if (typeof date !== 'string') return undefined
	if (!ISO_DATE.test(date)) return undefined
	return date
}

function isoToOverride(iso: string): { month: number; day: number } | null {
	const [, monthStr, dayStr] = iso.split('-')
	const month = Number(monthStr)
	const day = Number(dayStr)
	if (!Number.isInteger(month) || !Number.isInteger(day)) return null
	return { month, day }
}

export const Route = createFileRoute('/')({
	validateSearch: (raw): HomeSearch => ({ date: parseSearchDate(raw.date) }),
	beforeLoad: async ({ location }) => {
		const user = await getServerUser()
		if (!user) {
			throw redirect({
				to: '/login',
				search: { redirect: location.href },
			})
		}
		return { user }
	},
	loaderDeps: ({ search }) => ({ date: search.date }),
	loader: async ({ deps, context }) => {
		const override = deps.date ? isoToOverride(deps.date) : null
		return {
			memories: await getTodayMemories({ data: override }),
			isAdmin: context.user.isAdmin,
		}
	},
	component: Home,
})

function memoryKey(item: MemoryItem): string {
	return item.uuid
}

function Home() {
	const { user, logout } = useIdentity()
	const { memories, isAdmin } = Route.useLoaderData()
	const { user: serverUser } = Route.useRouteContext()
	const { date: activeDate } = Route.useSearch()

	// Use `serverUser` as fallback while the client-side `user` is ready
	// to avoid blank glitches on the browser.
	const finalUser = user || serverUser

	const emptyMessage = activeDate
		? `No memories for ${formatCaptureDate(activeDate)}.`
		: 'No memories on this day.'

	return (
		<Box p={8}>
			<Heading size="2xl">Welcome back</Heading>
			<Text mt={4} fontSize="lg">
				Signed in as {finalUser.email}
			</Text>

			{isAdmin && <AdminDateOverride activeDate={activeDate} />}

			{memories.length === 0 ? (
				<Text mt={6} fontSize="md">
					{emptyMessage}
				</Text>
			) : (
				<Stack mt={6} gap={8}>
					{memories.map((item) => (
						<MemoryView key={memoryKey(item)} item={item} />
					))}
				</Stack>
			)}

			<Button mt={6} onClick={() => void logout()}>
				Sign out
			</Button>
		</Box>
	)
}
