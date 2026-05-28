import type { SourceFileItem } from '#/lib/admin/source-folder.server'

import { AdminFolderNavigator } from '#/components/AdminFolderNavigator'
import { AppShell } from '#/components/AppShell'
import { CollectionItemsGrid } from '#/components/CollectionItemsGrid'
import { Topbar } from '#/components/Topbar'
import { addToCollection, getCollectionMedia, removeFromCollection } from '#/lib/admin/collection'
import { getAdminSourceFolder } from '#/lib/admin/source-folder'
import { getServerUser } from '#/lib/auth/auth'
import { Alert, Box, Container, Heading, Stack, Text } from '@chakra-ui/react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

type CollectionSearch = { folderid?: number }

export const Route = createFileRoute('/admin/collection')({
	validateSearch: (s: Record<string, unknown>): CollectionSearch => {
		const raw = s.folderid
		if (raw === undefined || raw === null || raw === '') return {}
		const n = Number(raw)
		return Number.isInteger(n) && n >= 0 ? { folderid: n } : {}
	},
	beforeLoad: async () => {
		const user = await getServerUser()
		if (!user) throw redirect({ to: '/login' })
		if (!user.isAdmin) throw redirect({ to: '/' })
		return { user }
	},
	loaderDeps: ({ search }) => ({ folderid: search.folderid }),
	loader: async ({ deps }) => {
		const [collection, source] = await Promise.all([
			getCollectionMedia(),
			getAdminSourceFolder({ data: { folderid: deps.folderid } }),
		])
		return { collection, source }
	},
	component: AdminCollectionPage,
})

function AdminCollectionPage() {
	const { collection, source } = Route.useLoaderData()
	const router = useRouter()
	const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
	const [picked, setPicked] = useState<ReadonlyMap<number, SourceFileItem>>(() => new Map())
	const [saving, setSaving] = useState(false)

	const collectionItems = collection.items
	const blocked = new Set(collectionItems.map((m) => m.fileid))

	async function handleRemove(uuid: string) {
		setPending((prev) => new Set(prev).add(uuid))
		try {
			await removeFromCollection({ data: { uuids: [uuid] } })
			await router.invalidate()
		} finally {
			setPending((prev) => {
				const next = new Set(prev)
				next.delete(uuid)
				return next
			})
		}
	}

	function handleNavigate(folderid: number) {
		router.navigate({ to: '/admin/collection', search: { folderid } })
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
			setPicked(new Map())
			await router.invalidate()
		} finally {
			setSaving(false)
		}
	}

	function handleCancel() {
		setPicked(new Map())
	}

	return (
		<AppShell>
			<Topbar />
			<Container as="main" maxW="1080px" px={{ base: 4, md: 4.5 }} pt={8} pb={20}>
				<Stack gap={2} mb={6}>
					<Heading
						as="h1"
						fontFamily="heading"
						fontWeight={400}
						fontStyle="italic"
						fontSize={{ base: '28px', md: '36px' }}
						color="ink"
					>
						Curación de colección
					</Heading>
					<Text color="ink.muted" fontSize="sm">
						Selecciona qué fotos y vídeos participan en la página principal.
					</Text>
				</Stack>

				<Alert.Root status="info" mb={8}>
					<Alert.Indicator />
					<Alert.Description fontSize="sm">
						Los cambios aparecen inmediatamente en la página principal.
					</Alert.Description>
				</Alert.Root>

				<Stack gap={4} mb={10}>
					<Heading as="h2" fontSize="lg" color="ink">
						En la colección ({collectionItems.length})
					</Heading>
					{collectionItems.length === 0 ? (
						<EmptyCollection />
					) : (
						<CollectionItemsGrid
							items={collectionItems}
							pending={pending}
							onRemove={handleRemove}
						/>
					)}
				</Stack>

				<Stack gap={4}>
					<Heading as="h2" fontSize="lg" color="ink">
						Añadir más
					</Heading>
					{source.status === 'source-folder-id-missing' && <SourceFolderMissingBanner />}
					{source.status === 'folder-not-permitted' && <FolderNotPermittedBanner />}
					{source.status === 'ok' && (
						<AdminFolderNavigator
							listing={source.listing}
							picked={new Set(picked.keys())}
							blocked={blocked}
							onNavigate={handleNavigate}
							onToggle={handleToggle}
							onSave={(ids) => {
								if (!saving) void handleSave(ids)
							}}
							onCancel={handleCancel}
							saving={saving}
						/>
					)}
				</Stack>
			</Container>
		</AppShell>
	)
}

function EmptyCollection() {
	return (
		<Box
			borderWidth="1px"
			borderStyle="dashed"
			borderColor="line"
			borderRadius="md"
			p={6}
			textAlign="center"
			color="ink.muted"
		>
			<Text fontSize="sm">
				La colección está vacía. Añade fotos o vídeos desde la cuadrícula inferior.
			</Text>
		</Box>
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
