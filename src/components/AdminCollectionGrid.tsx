import type { AdminFileItem } from '#/lib/admin/collection.server'

import { Box, Button, HStack, Image, SimpleGrid, Stack, Text, chakra } from '@chakra-ui/react'
import { Check, Play } from 'lucide-react'

const TileButton = chakra('button')

type AdminCollectionGridProps = {
	items: readonly AdminFileItem[]
	picked: ReadonlySet<string>
	blocked: ReadonlySet<string>
	onToggle: (uuid: string) => void
	onSave: (uuids: readonly string[]) => void
	onCancel: () => void
	saving?: boolean
}

export function AdminCollectionGrid({
	items,
	picked,
	blocked,
	onToggle,
	onSave,
	onCancel,
	saving = false,
}: AdminCollectionGridProps) {
	const hasPicked = picked.size > 0
	if (items.length === 0) {
		return <EmptyMedia />
	}
	return (
		<Stack gap={5}>
			<FileGrid items={items} picked={picked} blocked={blocked} onToggle={onToggle} />
			{hasPicked && (
				<StickyFooter
					count={picked.size}
					saving={saving}
					onSave={() => onSave([...picked])}
					onCancel={onCancel}
				/>
			)}
		</Stack>
	)
}

function FileGrid({
	items,
	picked,
	blocked,
	onToggle,
}: {
	items: ReadonlyArray<AdminFileItem>
	picked: ReadonlySet<string>
	blocked: ReadonlySet<string>
	onToggle: (uuid: string) => void
}) {
	return (
		<SimpleGrid columns={{ base: 2, sm: 3, md: 4 }} gap={3}>
			{items.map((item) => {
				const isPicked = picked.has(item.uuid)
				const isBlocked = blocked.has(item.uuid)
				return (
					<TileButton
						key={item.uuid}
						type="button"
						aria-label={`Seleccionar ${item.name}`}
						aria-pressed={isPicked}
						aria-disabled={isBlocked || undefined}
						onClick={() => {
							if (isBlocked) return
							onToggle(item.uuid)
						}}
						p={0}
						border="2px solid"
						borderColor={isPicked ? 'accent.500' : 'line'}
						borderRadius="md"
						overflow="hidden"
						bg="paper"
						cursor={isBlocked ? 'not-allowed' : 'pointer'}
						opacity={isBlocked ? 0.45 : 1}
						transition="border-color 0.15s ease, transform 0.15s ease"
						_hover={isBlocked ? {} : { borderColor: 'accent.300', transform: 'translateY(-1px)' }}
					>
						<Box position="relative" w="full" aspectRatio="square" bg="bg.muted">
							{item.thumbUrl ? (
								<Image
									src={item.thumbUrl}
									alt=""
									loading="lazy"
									w="full"
									h="full"
									objectFit="cover"
								/>
							) : (
								<Box
									w="full"
									h="full"
									display="flex"
									alignItems="center"
									justifyContent="center"
									color="ink.muted"
									fontSize="xs"
									fontFamily="mono"
								>
									sin miniatura
								</Box>
							)}
							{item.kind === 'video' && (
								<HStack
									position="absolute"
									bottom="6px"
									left="6px"
									bg="blackAlpha.600"
									color="white"
									px={1.5}
									py={0.5}
									borderRadius="full"
									fontSize="10px"
									fontFamily="mono"
									gap={1}
								>
									<Play size={9} fill="currentColor" aria-hidden />
									<Box as="span" letterSpacing="0.04em">
										VÍDEO
									</Box>
								</HStack>
							)}
							{isPicked && (
								<Box
									position="absolute"
									top="6px"
									right="6px"
									bg="accent.500"
									color="white"
									borderRadius="full"
									p={1}
									display="flex"
								>
									<Check size={12} aria-hidden />
								</Box>
							)}
						</Box>
						<Text
							px={2}
							py={1.5}
							fontSize="xs"
							fontFamily="mono"
							color="ink.muted"
							textAlign="center"
							truncate
						>
							{item.name}
						</Text>
					</TileButton>
				)
			})}
		</SimpleGrid>
	)
}

function EmptyMedia() {
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
				La caché todavía no contiene fotos ni vídeos. Ejecuta la sincronización (04:00 UTC) o invoca
				manualmente la función.
			</Text>
		</Box>
	)
}

function StickyFooter({
	count,
	saving,
	onSave,
	onCancel,
}: {
	count: number
	saving: boolean
	onSave: () => void
	onCancel: () => void
}) {
	return (
		<Box
			position="sticky"
			bottom={4}
			zIndex={2}
			bg="paper"
			border="1px solid"
			borderColor="line"
			borderRadius="md"
			boxShadow="md"
			p={3}
			display="flex"
			justifyContent="flex-end"
			gap={2}
		>
			<Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
				Cancelar
			</Button>
			<Button colorPalette="accent" size="sm" onClick={onSave} disabled={saving}>
				{saving ? 'Guardando…' : `Guardar (${count})`}
			</Button>
		</Box>
	)
}
