import type { SourceFileItem } from '#/lib/admin/source-folder.server'

import { Box, Button, HStack, Image, SimpleGrid, Text, chakra } from '@chakra-ui/react'
import { Check, Play } from 'lucide-react'

const TileButton = chakra('button')

// Shared media-picker primitives used by both the folder navigator ("Navegar")
// and the flat day grids ("Hoy"/"Mañana"). `onToggle` receives the whole item
// so callers can pick across multiple datasets without per-dataset lookups.

export function FileGrid({
	files,
	picked,
	blocked,
	onToggle,
}: {
	files: ReadonlyArray<SourceFileItem>
	picked: ReadonlySet<number>
	blocked: ReadonlySet<number>
	onToggle: (item: SourceFileItem) => void
}) {
	return (
		<SimpleGrid columns={{ base: 2, sm: 3, md: 4 }} gap={3}>
			{files.map((file) => {
				const isPicked = picked.has(file.fileid)
				const isBlocked = blocked.has(file.fileid)
				return (
					<TileButton
						key={file.fileid}
						type="button"
						aria-label={`Seleccionar ${file.name}`}
						aria-pressed={isPicked}
						aria-disabled={isBlocked || undefined}
						onClick={() => {
							if (isBlocked) return
							onToggle(file)
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
							{file.thumbUrl ? (
								<Image
									src={file.thumbUrl}
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
							{file.kind === 'video' && (
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
							{file.name}
						</Text>
					</TileButton>
				)
			})}
		</SimpleGrid>
	)
}

export function EmptyMedia({
	dateFilterActive = false,
	emptyMessage,
}: {
	/** True when a date filter is hiding media in the current folder. */
	dateFilterActive?: boolean
	/** Overrides the default copy (e.g. for the flat day grids). */
	emptyMessage?: string
}) {
	const message =
		emptyMessage ??
		(dateFilterActive
			? 'No hay fotos ni vídeos de esta fecha en esta carpeta.'
			: 'Esta carpeta no contiene fotos ni vídeos.')
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
			<Text fontSize="sm">{message}</Text>
		</Box>
	)
}

export function StickyFooter({
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
