import { AdminCollectionGrid } from '#/components/AdminCollectionGrid'
import { AppShell } from '#/components/AppShell'
import { Topbar } from '#/components/Topbar'
import { getAdminFolderMedia } from '#/lib/admin/folder-media'
import { getServerUser } from '#/lib/auth/auth'
import { Box, Container, Heading, Stack, Text } from '@chakra-ui/react'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/collection')({
	beforeLoad: async () => {
		const user = await getServerUser()
		if (!user) throw redirect({ to: '/login' })
		if (!user.isAdmin) throw redirect({ to: '/' })
		return { user }
	},
	loader: async () => ({ items: await getAdminFolderMedia() }),
	component: AdminCollectionPage,
})

function AdminCollectionPage() {
	const { items } = Route.useLoaderData()

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
						tiene {items.length} archivo{items.length === 1 ? '' : 's'}.
					</Text>
				</Stack>
				{items.length === 0 ? (
					<EmptyFolder />
				) : (
					<AdminCollectionGrid items={items} onToggle={() => {}} />
				)}
			</Container>
		</AppShell>
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
