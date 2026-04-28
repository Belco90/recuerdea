import type { MemoryItem } from '#/lib/pcloud.server'

import { getServerUser } from '#/lib/auth'
import { useIdentity } from '#/lib/identity-context'
import { getTodayMemories } from '#/lib/pcloud'
import {
	Box,
	Button,
	DatePicker,
	Flex,
	Heading,
	IconButton,
	Image,
	Input,
	parseDate,
	Portal,
	Stack,
	Text,
} from '@chakra-ui/react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Calendar } from 'lucide-react'

const captureDateFormatter = new Intl.DateTimeFormat(undefined, {
	year: 'numeric',
	month: 'long',
	day: 'numeric',
})

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

function todayIso(): string {
	const now = new Date()
	const yyyy = now.getFullYear()
	const mm = String(now.getMonth() + 1).padStart(2, '0')
	const dd = String(now.getDate()).padStart(2, '0')
	return `${yyyy}-${mm}-${dd}`
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

function formatCaptureDate(iso: string | null): string | null {
	if (!iso) return null
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return null
	return captureDateFormatter.format(date)
}

function MemoryView({ item }: { item: MemoryItem }) {
	const formatted = formatCaptureDate(item.captureDate)
	return (
		<Stack gap={2}>
			{item.kind === 'image' ? (
				<Image src={item.url} alt={item.name} maxW="md" />
			) : (
				<Box maxW="md">
					<video
						controls
						poster={item.posterUrl}
						src={item.url}
						style={{ width: '100%', display: 'block' }}
					>
						<track kind="captions" />
					</video>
				</Box>
			)}
			{formatted && (
				<Text fontSize="sm" color="gray.600">
					Taken {formatted}
				</Text>
			)}
		</Stack>
	)
}

function AdminDateOverride({ activeDate }: { activeDate: string | undefined }) {
	const navigate = Route.useNavigate()
	const value = activeDate ?? todayIso()

	return (
		<Stack mt={6} gap={2} maxW="sm">
			<Text fontSize="sm" color="gray.600">
				Admin: preview "today's memories" for any date
			</Text>
			<Flex gap={2} align="center">
				<DatePicker.Root
					selectionMode="single"
					startOfWeek={1}
					value={[parseDate(value)]}
					onValueChange={({ value: picked }) => {
						const next = picked[0]
						if (!next) return
						void navigate({ search: { date: next.toString() } })
					}}
				>
					<DatePicker.Control>
						<DatePicker.Input asChild>
							<Input size="sm" />
						</DatePicker.Input>
						<DatePicker.Trigger asChild>
							<IconButton size="sm" variant="outline" aria-label="Open calendar">
								<Calendar size={16} />
							</IconButton>
						</DatePicker.Trigger>
					</DatePicker.Control>
					<Portal>
						<DatePicker.Positioner>
							<DatePicker.Content>
								<DatePicker.View view="day">
									<DatePicker.Context>
										{(api) => (
											<Stack gap={2}>
												<DatePicker.ViewControl>
													<DatePicker.PrevTrigger asChild>
														<IconButton size="xs" variant="ghost" aria-label="Previous month">
															‹
														</IconButton>
													</DatePicker.PrevTrigger>
													<DatePicker.ViewTrigger asChild>
														<Button size="xs" variant="ghost">
															<DatePicker.RangeText />
														</Button>
													</DatePicker.ViewTrigger>
													<DatePicker.NextTrigger asChild>
														<IconButton size="xs" variant="ghost" aria-label="Next month">
															›
														</IconButton>
													</DatePicker.NextTrigger>
												</DatePicker.ViewControl>
												<DatePicker.Table>
													<DatePicker.TableHead>
														<DatePicker.TableRow>
															{api.weekDays.map((day) => (
																<DatePicker.TableHeader key={day.short}>
																	{day.narrow}
																</DatePicker.TableHeader>
															))}
														</DatePicker.TableRow>
													</DatePicker.TableHead>
													<DatePicker.TableBody>
														{api.weeks.map((week) => (
															<DatePicker.TableRow key={week[0].toString()}>
																{week.map((day) => (
																	<DatePicker.TableCell key={day.toString()} value={day}>
																		<DatePicker.TableCellTrigger>
																			{day.day}
																		</DatePicker.TableCellTrigger>
																	</DatePicker.TableCell>
																))}
															</DatePicker.TableRow>
														))}
													</DatePicker.TableBody>
												</DatePicker.Table>
											</Stack>
										)}
									</DatePicker.Context>
								</DatePicker.View>
							</DatePicker.Content>
						</DatePicker.Positioner>
					</Portal>
				</DatePicker.Root>
				{activeDate && (
					<Button size="sm" variant="ghost" onClick={() => void navigate({ search: {} })}>
						Reset to today
					</Button>
				)}
			</Flex>
		</Stack>
	)
}

function memoryKey(item: MemoryItem): string {
	return `${item.captureDate}-${item.name}`
}

function Home() {
	const { user, logout } = useIdentity()
	const { memories } = Route.useLoaderData()
	const { date: activeDate } = Route.useSearch()

	const isAdmin = user?.role === 'admin' || (user?.roles?.includes('admin') ?? false)

	const emptyMessage = activeDate
		? `No memories for ${formatCaptureDate(activeDate)}.`
		: 'No memories on this day.'

	return (
		<Box p={8}>
			<Heading size="2xl">Welcome back</Heading>
			<Text mt={4} fontSize="lg">
				Signed in as {user?.email}
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
