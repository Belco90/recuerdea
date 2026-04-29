import { Home } from '#/components/Home'
import { getServerUser } from '#/lib/auth'
import { getTodayMemories } from '#/lib/pcloud'
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
	},
	loaderDeps: ({ search }) => ({ date: search.date }),
	loader: async ({ deps }) => {
		const override = deps.date ? isoToOverride(deps.date) : null
		return { memories: await getTodayMemories({ data: override }) }
	},
	component: Home,
})
