import { AppShell } from '#/components/AppShell'
import { CollectionListSkeleton } from '#/components/RouteSkeletons'
import { Topbar } from '#/components/Topbar'
import { getCollectionMedia } from '#/lib/admin/collection'
import { getServerUser } from '#/lib/auth/auth'
import { Container, Heading, Stack, Text } from '@chakra-ui/react'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/collection')({
	beforeLoad: async () => {
		const user = await getServerUser()
		if (!user) throw redirect({ to: '/login' })
		if (!user.isAdmin) throw redirect({ to: '/' })
		return { user }
	},
	loader: async () => ({ collection: await getCollectionMedia() }),
	pendingComponent: CollectionListSkeleton,
	component: AdminCollectionLayout,
})

function AdminCollectionLayout() {
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
				<Outlet />
			</Container>
		</AppShell>
	)
}
