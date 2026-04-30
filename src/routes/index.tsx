import type { MemoryItem } from '#/lib/pcloud.server'

import { AdminDateOverride } from '#/components/AdminDateOverride'
import { AppShell } from '#/components/AppShell'
import { MemoryView } from '#/components/MemoryView'
import { Topbar } from '#/components/Topbar'
import { getServerUser } from '#/lib/auth'
import { formatCaptureDate } from '#/lib/date'
import { getTodayMemories } from '#/lib/pcloud'
import { Box, Container, Stack, Text } from '@chakra-ui/react'
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
	const { memories, isAdmin } = Route.useLoaderData()
	const { date: activeDate } = Route.useSearch()

	const emptyMessage = activeDate
		? `No memories for ${formatCaptureDate(activeDate)}.`
		: 'No memories on this day.'

	return (
		<AppShell>
			<Topbar />
			{isAdmin && <AdminDateOverride activeDate={activeDate} />}
			<Container as="main" maxW="1080px" px={{ base: 4, md: 4.5 }} pt={8} pb={20}>
				{memories.length === 0 ? (
					<Box pt={8}>
						<Text fontSize="md" color="ink.muted">
							{emptyMessage}
						</Text>
					</Box>
				) : (
					<Stack gap={8}>
						{memories.map((item) => (
							<MemoryView key={memoryKey(item)} item={item} />
						))}
					</Stack>
				)}
			</Container>
		</AppShell>
	)
}
