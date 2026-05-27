import { AdminCollectionGrid } from '#/components/AdminCollectionGrid'
import { AppShell } from '#/components/AppShell'
import { CollectionItemsGrid } from '#/components/CollectionItemsGrid'
import { Topbar } from '#/components/Topbar'
import { addToCollection, getCollectionMedia, removeFromCollection } from '#/lib/admin/collection'
import { getAdminFolderMedia } from '#/lib/admin/folder-media'
import { getServerUser } from '#/lib/auth/auth'
import { Box, Container, Heading, Stack, Text } from '@chakra-ui/react'
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
	const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
	const [saving, setSaving] = useState(false)

	const collectionItems = collection.items
	const blocked = new Set(collectionItems.map((m) => m.uuid))

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

	function handleToggle(uuid: string) {
		setPicked((prev) => {
			const next = new Set(prev)
			if (next.has(uuid)) next.delete(uuid)
			else next.add(uuid)
			return next
		})
	}

	async function handleSave(uuids: readonly string[]) {
		if (uuids.length === 0) return
		setSaving(true)
		try {
			await addToCollection({ data: { uuids } })
			setPicked(new Set())
			await router.invalidate()
		} finally {
			setSaving(false)
		}
	}

	function handleCancel() {
		setPicked(new Set())
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
					<AdminCollectionGrid
						items={folder.items}
						picked={picked}
						blocked={blocked}
						onToggle={handleToggle}
						onSave={(uuids) => {
							if (!saving) void handleSave(uuids)
						}}
						onCancel={handleCancel}
						saving={saving}
					/>
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
