import { CollectionItemsGrid } from '#/components/CollectionItemsGrid'
import { removeFromCollection } from '#/lib/admin/collection'
import { Alert, Box, HStack, Heading, Stack, Text, chakra } from '@chakra-ui/react'
import {
	Link as RouterLink,
	createFileRoute,
	useLoaderData,
	useRouter,
} from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'

const Link = chakra(RouterLink)

export const Route = createFileRoute('/admin/collection/')({
	component: AdminCollectionIndex,
})

function AdminCollectionIndex() {
	const { collection } = useLoaderData({ from: '/admin/collection' })
	const router = useRouter()
	const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
	const items = collection.items

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

	return (
		<Stack gap={6}>
			<Alert.Root status="info">
				<Alert.Indicator />
				<Alert.Description fontSize="sm">
					Los cambios aparecen inmediatamente en la página principal.
				</Alert.Description>
			</Alert.Root>

			<Stack
				direction={{ base: 'column', sm: 'row' }}
				justify="space-between"
				align={{ base: 'stretch', sm: 'center' }}
				gap={3}
			>
				<Heading as="h2" fontSize="lg" color="ink">
					En la colección ({items.length})
				</Heading>
				<Link
					to="/admin/collection/add"
					display="inline-flex"
					alignItems="center"
					gap={1.5}
					py={2}
					px={3}
					borderWidth="1px"
					borderColor="line"
					borderRadius="md"
					color="ink"
					fontSize="sm"
					textDecoration="none"
					_hover={{ bg: 'paper/70', borderColor: 'ink.muted' }}
				>
					<HStack gap={1.5}>
						<Plus size={14} aria-hidden />
						<Box as="span">Añadir más</Box>
					</HStack>
				</Link>
			</Stack>

			{items.length === 0 ? (
				<EmptyCollection />
			) : (
				<CollectionItemsGrid items={items} pending={pending} onRemove={handleRemove} />
			)}
		</Stack>
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
				La colección está vacía. Usa <strong>Añadir más</strong> para seleccionar fotos o vídeos.
			</Text>
		</Box>
	)
}
