import { AppShell } from '#/components/AppShell'
import { CollectionItemsGrid } from '#/components/CollectionItemsGrid'
import { Topbar } from '#/components/Topbar'
import { getCollectionMedia, unlinkFilesFromCollection } from '#/lib/admin/collection'
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
		const collection = await getCollectionMedia()
		return { collection }
	},
	component: AdminCollectionPage,
})

function AdminCollectionPage() {
	const { collection } = Route.useLoaderData()
	const router = useRouter()
	const [pending, setPending] = useState<ReadonlySet<number>>(() => new Set())

	const collectionItems = collection.status === 'ok' ? collection.items : []

	async function handleRemove(fileid: number) {
		setPending((prev) => new Set(prev).add(fileid))
		try {
			await unlinkFilesFromCollection({ data: { fileids: [fileid] } })
			await router.invalidate()
		} finally {
			setPending((prev) => {
				const next = new Set(prev)
				next.delete(fileid)
				return next
			})
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
						Selecciona qué fotos y vídeos participan en la página principal.
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
				La colección está vacía. La interfaz para añadir archivos llegará en la siguiente fase.
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
