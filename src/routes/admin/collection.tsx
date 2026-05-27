import { AdminCollectionGrid } from '#/components/AdminCollectionGrid'
import { AppShell } from '#/components/AppShell'
import { CollectionItemsGrid } from '#/components/CollectionItemsGrid'
import { Topbar } from '#/components/Topbar'
import {
	getCollectionMedia,
	linkFilesToCollection,
	unlinkFilesFromCollection,
} from '#/lib/admin/collection'
import { getAdminFolderMedia } from '#/lib/admin/folder-media'
import { getServerUser } from '#/lib/auth/auth'
import { Alert, Box, Button, Container, Heading, HStack, Stack, Text } from '@chakra-ui/react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/admin/collection')({
	beforeLoad: async () => {
		const user = await getServerUser()
		if (!user) throw redirect({ to: '/login' })
		if (!user.isAdmin) throw redirect({ to: '/' })
		return { user }
	},
	loader: async () => {
		const [collection, folder] = await Promise.all([getCollectionMedia(), getAdminFolderMedia()])
		return { collection, folder }
	},
	component: AdminCollectionPage,
})

function AdminCollectionPage() {
	const { collection, folder } = Route.useLoaderData()
	const router = useRouter()
	const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
	const [showAddPanel, setShowAddPanel] = useState(false)
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
	const [saving, setSaving] = useState(false)

	const collectionItems = collection.status === 'ok' ? collection.items : []
	const inCollection = new Set(collectionItems.map((m) => m.uuid))
	const canMutate = collection.status === 'ok'

	function toggleSelection(uuid: string) {
		if (inCollection.has(uuid)) return
		setSelected((prev) => {
			const next = new Set(prev)
			if (next.has(uuid)) next.delete(uuid)
			else next.add(uuid)
			return next
		})
	}

	async function handleRemove(uuid: string) {
		setPending((prev) => new Set(prev).add(uuid))
		try {
			await unlinkFilesFromCollection({ data: { uuids: [uuid] } })
			await router.invalidate()
		} finally {
			setPending((prev) => {
				const next = new Set(prev)
				next.delete(uuid)
				return next
			})
		}
	}

	async function handleSave() {
		if (selected.size === 0) return
		setSaving(true)
		try {
			await linkFilesToCollection({ data: { uuids: [...selected] } })
			setSelected(new Set())
			setShowAddPanel(false)
			await router.invalidate()
		} finally {
			setSaving(false)
		}
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
						Selecciona qué fotos y vídeos participan en la página principal. La carpeta supervisada
						tiene {folder.length} archivo{folder.length === 1 ? '' : 's'}.
					</Text>
				</Stack>

				<Alert.Root status="info" mb={8}>
					<Alert.Indicator />
					<Alert.Description fontSize="sm">
						Los cambios aparecerán en la página principal tras la próxima sincronización (04:00
						UTC).
					</Alert.Description>
				</Alert.Root>

				{collection.status === 'unconfigured' ? (
					<UnconfiguredBanner />
				) : (
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
				)}

				{canMutate && (
					<Stack gap={4}>
						<HStack justify="space-between" align="center" flexWrap="wrap" gap={3}>
							<Heading as="h2" fontSize="lg" color="ink">
								{showAddPanel ? `Selecciona archivos (${folder.length})` : 'Añadir más'}
							</Heading>
							{showAddPanel ? (
								<HStack gap={2}>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											setShowAddPanel(false)
											setSelected(new Set())
										}}
										disabled={saving}
									>
										Cancelar
									</Button>
									<Button
										colorPalette="accent"
										size="sm"
										onClick={handleSave}
										disabled={selected.size === 0 || saving}
									>
										{saving ? 'Guardando…' : `Guardar (${selected.size})`}
									</Button>
								</HStack>
							) : (
								<Button
									variant="outline"
									size="sm"
									onClick={() => setShowAddPanel(true)}
									disabled={folder.length === 0}
								>
									Añadir más
								</Button>
							)}
						</HStack>
						{showAddPanel &&
							(folder.length === 0 ? (
								<EmptyFolder />
							) : (
								<AdminCollectionGrid
									items={folder}
									selected={selected}
									disabled={inCollection}
									onToggle={toggleSelection}
								/>
							))}
					</Stack>
				)}
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

function EmptyFolder() {
	return (
		<Box
			borderWidth="1px"
			borderStyle="dashed"
			borderColor="line"
			borderRadius="md"
			p={8}
			textAlign="center"
			color="ink.muted"
		>
			<Text fontSize="sm">
				No hay archivos en la caché. Ejecuta el cron de sincronización y vuelve a cargar la página.
			</Text>
		</Box>
	)
}

function UnconfiguredBanner() {
	return (
		<Alert.Root status="warning" mb={10}>
			<Alert.Indicator />
			<Alert.Content>
				<Alert.Title>Configura PCLOUD_COLLECTION_ID</Alert.Title>
				<Alert.Description>
					Define la variable de entorno PCLOUD_COLLECTION_ID en Netlify para enlazar esta vista con
					una colección de pCloud.
				</Alert.Description>
			</Alert.Content>
		</Alert.Root>
	)
}
