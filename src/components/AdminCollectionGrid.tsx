import type { AdminMediaItem } from '#/lib/admin/folder-media.server'

import { Box, HStack, Image, SimpleGrid, Text, chakra } from '@chakra-ui/react'
import { Check, Play } from 'lucide-react'

const TileButton = chakra('button')

type AdminCollectionGridProps = {
	items: readonly AdminMediaItem[]
	selected?: ReadonlySet<string>
	disabled?: ReadonlySet<string>
	onToggle: (uuid: string) => void
}

const EMPTY = new Set<string>()

function captionFor(item: AdminMediaItem): string {
	if (!item.captureDate) return 'sin fecha'
	const year = new Date(item.captureDate).getFullYear()
	return Number.isFinite(year) ? String(year) : 'sin fecha'
}

export function AdminCollectionGrid({
	items,
	selected = EMPTY,
	disabled = EMPTY,
	onToggle,
}: AdminCollectionGridProps) {
	return (
		<SimpleGrid columns={{ base: 2, sm: 3, md: 4 }} gap={3}>
			{items.map((item) => {
				const isSelected = selected.has(item.uuid)
				const isDisabled = disabled.has(item.uuid)
				return (
					<TileButton
						key={item.uuid}
						type="button"
						aria-label={item.name}
						aria-pressed={isSelected}
						disabled={isDisabled}
						onClick={() => onToggle(item.uuid)}
						p={0}
						border="2px solid"
						borderColor={isSelected ? 'accent.500' : 'line'}
						borderRadius="md"
						overflow="hidden"
						bg="paper"
						cursor={isDisabled ? 'not-allowed' : 'pointer'}
						opacity={isDisabled ? 0.45 : 1}
						transition="border-color 0.15s ease, transform 0.15s ease"
						_hover={isDisabled ? {} : { borderColor: 'accent.300', transform: 'translateY(-1px)' }}
					>
						<Box position="relative" w="full" aspectRatio="square" bg="bg.muted">
							<Image
								src={item.thumbUrl}
								alt=""
								loading="lazy"
								w="full"
								h="full"
								objectFit="cover"
							/>
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
							{isSelected && (
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
						>
							{captionFor(item)}
						</Text>
					</TileButton>
				)
			})}
		</SimpleGrid>
	)
}
