import type { SourceFileItem } from '#/lib/admin/source-folder.server'

import { AdminFolderNavigator } from '#/components/AdminFolderNavigator'
import { AdminMediaDateFilter } from '#/components/AdminMediaDateFilter'
import { addToCollection } from '#/lib/admin/collection'
import { filterFilesByDay } from '#/lib/admin/date-filter'
import { getAdminSourceFolder } from '#/lib/admin/source-folder'
import { Alert, Heading, Stack, chakra } from '@chakra-ui/react'
import {
	Link as RouterLink,
	createFileRoute,
	useLoaderData,
	useRouter,
} from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'

const Link = chakra(RouterLink)

type AddSearch = { folderid?: number; date?: string }

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
		return out
	},
	// `date` is intentionally excluded: filtering is client-side, so changing it
	// must re-filter in place without re-fetching the folder from pCloud.
	loaderDeps: ({ search }) => ({ folderid: search.folderid }),
	loader: async ({ deps }) => ({
		source: await getAdminSourceFolder({ data: { folderid: deps.folderid } }),
	}),
	component: AdminCollectionAddPage,
})

function AdminCollectionAddPage() {
	const { collection } = useLoaderData({ from: '/admin/collection' })
	const { source } = Route.useLoaderData()
	const { date } = Route.useSearch()
	const router = useRouter()
	const [picked, setPicked] = useState<ReadonlyMap<number, SourceFileItem>>(() => new Map())
	const [saving, setSaving] = useState(false)

	const blocked = new Set(collection.items.map((m) => m.fileid))

	function handleNavigate(folderid: number) {
		// Preserve the active date filter when moving between folders.
		router.navigate({ to: '/admin/collection/add', search: (prev) => ({ ...prev, folderid }) })
	}

	function handleDateChange(next: string | undefined) {
		router.navigate({ to: '/admin/collection/add', search: (prev) => ({ ...prev, date: next }) })
	}

	function handleToggle(fileid: number) {
		const file =
			source.status === 'ok' ? source.listing.files.find((f) => f.fileid === fileid) : null
		if (!file) return
		setPicked((prev) => {
			const next = new Map(prev)
			if (next.has(fileid)) next.delete(fileid)
			else next.set(fileid, file)
			return next
		})
	}

	async function handleSave(fileids: readonly number[]) {
		if (fileids.length === 0) return
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

			{source.status === 'source-folder-id-missing' && <SourceFolderMissingBanner />}
			{source.status === 'folder-not-permitted' && <FolderNotPermittedBanner />}
			{source.status === 'ok' && (
				<>
					<AdminMediaDateFilter value={date} onChange={handleDateChange} />
					<AdminFolderNavigator
						listing={{
							...source.listing,
							files: filterFilesByDay(source.listing.files, date),
						}}
						picked={new Set(picked.keys())}
						blocked={blocked}
						onNavigate={handleNavigate}
						onToggle={handleToggle}
						onSave={(ids) => {
							if (!saving) void handleSave(ids)
						}}
						onCancel={handleCancel}
						saving={saving}
						dateFilterActive={date !== undefined}
					/>
				</>
			)}
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
