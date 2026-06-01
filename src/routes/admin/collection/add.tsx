import type {
	AdminSourceDayResult,
	AdminSourceFolderResult,
	SourceFileItem,
} from '#/lib/admin/source-folder'

import { AdminFolderNavigator } from '#/components/AdminFolderNavigator'
import { AdminMediaDateFilter } from '#/components/AdminMediaDateFilter'
import { EmptyMedia, FileGrid, StickyFooter } from '#/components/AdminMediaGrid'
import { AddSkeleton } from '#/components/RouteSkeletons'
import { addToCollection } from '#/lib/admin/collection'
import { filterFilesByDay } from '#/lib/admin/date-filter'
import { getAdminSourceDayMedia, getAdminSourceFolder } from '#/lib/admin/source-folder'
import { Alert, Heading, Stack, Tabs, chakra } from '@chakra-ui/react'
import {
	Link as RouterLink,
	createFileRoute,
	useLoaderData,
	useRouter,
} from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'

const Link = chakra(RouterLink)

// `hoy`/`manana` flatten the whole source tree by today's/tomorrow's day;
// `navegar` is the folder browser. ASCII keys keep the URL search param clean.
type TabKey = 'hoy' | 'manana' | 'navegar'
const TAB_KEYS: ReadonlySet<string> = new Set<TabKey>(['hoy', 'manana', 'navegar'])
const DEFAULT_TAB: TabKey = 'hoy'

type AddSearch = { folderid?: number; date?: string; tab?: TabKey }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const Route = createFileRoute('/admin/collection/add')({
	validateSearch: (s: Record<string, unknown>): AddSearch => {
		const out: AddSearch = {}
		const rawFolder = s.folderid
		if (rawFolder !== undefined && rawFolder !== null && rawFolder !== '') {
			const n = Number(rawFolder)
			if (Number.isInteger(n) && n >= 0) out.folderid = n
		}
		const rawDate = s.date
		if (typeof rawDate === 'string' && DATE_RE.test(rawDate)) out.date = rawDate
		const rawTab = s.tab
		if (typeof rawTab === 'string' && TAB_KEYS.has(rawTab)) out.tab = rawTab as TabKey
		return out
	},
	// `tab` drives which dataset we fetch; `folderid` only matters in the
	// `navegar` branch. `date` stays out — it filters the navegar grid in the
	// browser, so changing it must re-filter in place without re-fetching.
	loaderDeps: ({ search }) => ({ folderid: search.folderid, tab: search.tab ?? DEFAULT_TAB }),
	loader: async ({ deps }) => {
		if (deps.tab === 'hoy' || deps.tab === 'manana') {
			const which = deps.tab === 'hoy' ? 'today' : 'tomorrow'
			return { mode: 'day' as const, day: await getAdminSourceDayMedia({ data: { which } }) }
		}
		return {
			mode: 'navigate' as const,
			source: await getAdminSourceFolder({ data: { folderid: deps.folderid } }),
		}
	},
	pendingComponent: AddSkeleton,
	component: AdminCollectionAddPage,
})

function AdminCollectionAddPage() {
	const { collection } = useLoaderData({ from: '/admin/collection' })
	const data = Route.useLoaderData()
	const { date, tab = DEFAULT_TAB } = Route.useSearch()
	const router = useRouter()
	const [picked, setPicked] = useState<ReadonlyMap<number, SourceFileItem>>(() => new Map())
	const [saving, setSaving] = useState(false)

	const blocked = new Set(collection.items.map((m) => m.fileid))
	const pickedIds = new Set(picked.keys())

	function handleTabChange(next: TabKey) {
		router.navigate({ to: '/admin/collection/add', search: (prev) => ({ ...prev, tab: next }) })
	}

	function handleNavigate(folderid: number) {
		// Preserve the active date filter when moving between folders.
		router.navigate({ to: '/admin/collection/add', search: (prev) => ({ ...prev, folderid }) })
	}

	function handleDateChange(next: string | undefined) {
		router.navigate({ to: '/admin/collection/add', search: (prev) => ({ ...prev, date: next }) })
	}

	// Toggle by item: picks accumulate across all three tabs (different datasets),
	// so we store the item rather than look it up in a single listing.
	function handleToggle(item: SourceFileItem) {
		setPicked((prev) => {
			const next = new Map(prev)
			if (next.has(item.fileid)) next.delete(item.fileid)
			else next.set(item.fileid, item)
			return next
		})
	}

	async function handleSave() {
		const fileids = [...picked.keys()]
		if (fileids.length === 0 || saving) return
		setSaving(true)
		try {
			await addToCollection({ data: { fileids } })
			await router.invalidate()
			router.navigate({ to: '/admin/collection' })
		} finally {
			setSaving(false)
		}
	}

	function handleCancel() {
		router.navigate({ to: '/admin/collection' })
	}

	const dayBody =
		data.mode === 'day' ? (
			<DayTab day={data.day} picked={pickedIds} blocked={blocked} onToggle={handleToggle} />
		) : null

	const navigateBody =
		data.mode === 'navigate' ? (
			<NavigateTab
				source={data.source}
				date={date}
				picked={pickedIds}
				blocked={blocked}
				onNavigate={handleNavigate}
				onToggle={handleToggle}
				onDateChange={handleDateChange}
			/>
		) : null

	return (
		<Stack gap={4}>
			<Link
				to="/admin/collection"
				display="inline-flex"
				alignItems="center"
				gap={1}
				fontSize="sm"
				color="ink.muted"
				textDecoration="none"
				_hover={{ color: 'ink' }}
				w="fit-content"
			>
				<ChevronLeft size={14} aria-hidden /> Colección
			</Link>

			<Heading as="h2" fontSize="lg" color="ink">
				Añadir más
			</Heading>

			<Tabs.Root value={tab} onValueChange={(e) => handleTabChange(e.value as TabKey)}>
				<Tabs.List>
					<Tabs.Trigger value="hoy">Hoy</Tabs.Trigger>
					<Tabs.Trigger value="manana">Mañana</Tabs.Trigger>
					<Tabs.Trigger value="navegar">Navegar</Tabs.Trigger>
				</Tabs.List>

				{/* Only the active tab's data is loaded, so each panel renders its
				    body only when it is the current tab. */}
				<Tabs.Content value="hoy">{tab === 'hoy' ? dayBody : null}</Tabs.Content>
				<Tabs.Content value="manana">{tab === 'manana' ? dayBody : null}</Tabs.Content>
				<Tabs.Content value="navegar">{tab === 'navegar' ? navigateBody : null}</Tabs.Content>
			</Tabs.Root>

			{picked.size > 0 && (
				<StickyFooter
					count={picked.size}
					saving={saving}
					onSave={() => void handleSave()}
					onCancel={handleCancel}
				/>
			)}
		</Stack>
	)
}

function DayTab({
	day,
	picked,
	blocked,
	onToggle,
}: {
	day: AdminSourceDayResult
	picked: ReadonlySet<number>
	blocked: ReadonlySet<number>
	onToggle: (item: SourceFileItem) => void
}) {
	if (day.status === 'source-folder-id-missing') return <SourceFolderMissingBanner />
	const which = day.day.which
	return day.day.files.length > 0 ? (
		<FileGrid files={day.day.files} picked={picked} blocked={blocked} onToggle={onToggle} />
	) : (
		<EmptyMedia
			emptyMessage={`No hay fotos ni vídeos de ${which === 'today' ? 'hoy' : 'mañana'} en todo el archivo.`}
		/>
	)
}

function NavigateTab({
	source,
	date,
	picked,
	blocked,
	onNavigate,
	onToggle,
	onDateChange,
}: {
	source: AdminSourceFolderResult
	date: string | undefined
	picked: ReadonlySet<number>
	blocked: ReadonlySet<number>
	onNavigate: (folderid: number) => void
	onToggle: (item: SourceFileItem) => void
	onDateChange: (date: string | undefined) => void
}) {
	if (source.status === 'source-folder-id-missing') return <SourceFolderMissingBanner />
	if (source.status === 'folder-not-permitted') return <FolderNotPermittedBanner />
	return (
		<Stack gap={4}>
			<AdminMediaDateFilter value={date} onChange={onDateChange} />
			<AdminFolderNavigator
				listing={{
					...source.listing,
					files: filterFilesByDay(source.listing.files, date),
				}}
				picked={picked}
				blocked={blocked}
				onNavigate={onNavigate}
				onToggle={onToggle}
				dateFilterActive={date !== undefined}
			/>
		</Stack>
	)
}

function SourceFolderMissingBanner() {
	return (
		<Alert.Root status="warning">
			<Alert.Indicator />
			<Alert.Content>
				<Alert.Title>Configura PCLOUD_SOURCE_FOLDER_ID</Alert.Title>
				<Alert.Description>
					Define la variable de entorno PCLOUD_SOURCE_FOLDER_ID en Netlify para habilitar la
					navegación por carpetas.
				</Alert.Description>
			</Alert.Content>
		</Alert.Root>
	)
}

function FolderNotPermittedBanner() {
	return (
		<Alert.Root status="error">
			<Alert.Indicator />
			<Alert.Content>
				<Alert.Title>Carpeta no permitida</Alert.Title>
				<Alert.Description>
					La carpeta solicitada está fuera del árbol supervisado. Vuelve a la raíz para continuar.
				</Alert.Description>
			</Alert.Content>
		</Alert.Root>
	)
}
