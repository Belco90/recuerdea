import { AdminDateOverride } from '#/components/AdminDateOverride'
import { AppShell } from '#/components/AppShell'
import { EmptyState } from '#/components/EmptyState'
import { Hero } from '#/components/Hero'
import { Lightbox } from '#/components/Lightbox'
import { Timeline } from '#/components/Timeline'
import { Topbar } from '#/components/Topbar'
import { YearSection } from '#/components/YearSection'
import { getServerUser } from '#/lib/auth'
import { groupMemoriesByYear } from '#/lib/memory-grouping'
import { getTodayMemories } from '#/lib/pcloud'
import { spanishMonth } from '#/lib/spanish-months'
import { Container } from '@chakra-ui/react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'

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

function todayParts(activeDate: string | undefined): { year: number; month: number; day: number } {
	if (activeDate) {
		const [y, m, d] = activeDate.split('-').map(Number)
		if (y && m && d) return { year: y, month: m, day: d }
	}
	const now = new Date()
	return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
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

type LightboxState = { yearIndex: number; idx: number }

function Home() {
	const { memories, isAdmin } = Route.useLoaderData()
	const { date: activeDate } = Route.useSearch()
	const [lightbox, setLightbox] = useState<LightboxState | null>(null)

	const today = todayParts(activeDate)
	const todayDisplay = { day: today.day, month: spanishMonth(today.month - 1), year: today.year }
	const groups = groupMemoriesByYear(memories, today)

	const handleOpen = (year: number, idx: number) => {
		const yearIndex = groups.findIndex((g) => g.year === year)
		if (yearIndex >= 0) setLightbox({ yearIndex, idx })
	}

	const activeGroup = lightbox ? groups[lightbox.yearIndex] : null

	return (
		<AppShell>
			<Topbar />
			{isAdmin && <AdminDateOverride activeDate={activeDate} />}
			<Container as="main" maxW="1080px" px={{ base: 4, md: 4.5 }} pt={8} pb={20}>
				<Hero today={todayDisplay} totalItems={memories.length} groupCount={groups.length} />
				{groups.length === 0 ? (
					<EmptyState today={todayDisplay} />
				) : (
					<Timeline>
						{groups.map((group) => (
							<YearSection key={group.year} group={group} onOpen={handleOpen} />
						))}
					</Timeline>
				)}
			</Container>
			{activeGroup && lightbox && (
				<Lightbox
					group={activeGroup}
					startIndex={lightbox.idx}
					open={true}
					onClose={() => setLightbox(null)}
				/>
			)}
		</AppShell>
	)
}
