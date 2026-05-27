import { AdminCollectionGrid } from '#/components/AdminCollectionGrid'
import { AppShell } from '#/components/AppShell'
import { CollectionItemsGrid } from '#/components/CollectionItemsGrid'
import { Topbar } from '#/components/Topbar'
import { getCollectionMedia, unlinkFilesFromCollection } from '#/lib/admin/collection'
import { getAdminFolderMedia } from '#/lib/admin/folder-media'
import { getServerUser } from '#/lib/auth/auth'
import { Alert, Box, Container, Heading, Stack, Text } from '@chakra-ui/react'
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

	const collectionItems = collection.status === 'ok' ? collection.items : []
	const inCollection = new Set(collectionItems.map((m) => m.uuid))

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

	return (
		<AppShell>
			<Topbar />
			<Container as="main" maxW="1080px" px={{ base: 4, md: 4.5 }} pt={8} pb={20}>
				<Stack gap={2} mb={8}>
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

				<Stack gap={4}>
					<Heading as="h2" fontSize="lg" color="ink">
						Todos los archivos ({folder.length})
					</Heading>
					{folder.length === 0 ? (
						<EmptyFolder />
					) : (
						<AdminCollectionGrid items={folder} disabled={inCollection} onToggle={() => {}} />
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
