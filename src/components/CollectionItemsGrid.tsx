import type { AdminMediaItem } from '#/lib/admin/folder-media.server'

import { Box, Button, HStack, Image, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { Play, Trash2 } from 'lucide-react'

type CollectionItemsGridProps = {
	items: readonly AdminMediaItem[]
	pending?: ReadonlySet<string>
	onRemove: (uuid: string) => void
}

const EMPTY = new Set<string>()

function captionFor(item: AdminMediaItem): string {
	if (!item.captureDate) return 'sin fecha'
	const year = new Date(item.captureDate).getFullYear()
	return Number.isFinite(year) ? String(year) : 'sin fecha'
}

export function CollectionItemsGrid({
	items,
	pending = EMPTY,
	onRemove,
}: CollectionItemsGridProps) {
	return (
		<SimpleGrid columns={{ base: 2, sm: 3, md: 4 }} gap={3}>
			{items.map((item) => {
				const isPending = pending.has(item.uuid)
				return (
					<Stack
						key={item.uuid}
						gap={0}
						border="1px solid"
						borderColor="line"
						borderRadius="md"
						overflow="hidden"
						bg="paper"
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
						</Box>
						<Text
							px={2}
							pt={1.5}
							fontSize="xs"
							fontFamily="mono"
							color="ink.muted"
							textAlign="center"
						>
							{captionFor(item)}
						</Text>
						<Button
							size="xs"
							variant="ghost"
							color="ink.muted"
							disabled={isPending}
							onClick={() => onRemove(item.uuid)}
							aria-label={`Quitar ${item.name}`}
							my={1}
							mx={2}
						>
							<Trash2 size={12} aria-hidden />
							<Box as="span" ml={1}>
								{isPending ? 'Quitando…' : 'Quitar'}
							</Box>
						</Button>
					</Stack>
				)
			})}
		</SimpleGrid>
	)
}
