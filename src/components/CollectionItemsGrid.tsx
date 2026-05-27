import type { AdminFileItem } from '#/lib/admin/collection.server'

import { Box, Button, HStack, Image, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { Play, Trash2 } from 'lucide-react'

type CollectionItemsGridProps = {
	items: readonly AdminFileItem[]
	pending?: ReadonlySet<number>
	onRemove: (fileid: number) => void
}

const EMPTY = new Set<number>()

export function CollectionItemsGrid({
	items,
	pending = EMPTY,
	onRemove,
}: CollectionItemsGridProps) {
	return (
		<SimpleGrid columns={{ base: 2, sm: 3, md: 4 }} gap={3}>
			{items.map((item) => {
				const isPending = pending.has(item.fileid)
				return (
					<Stack
						key={item.fileid}
						gap={0}
						border="1px solid"
						borderColor="line"
						borderRadius="md"
						overflow="hidden"
						bg="paper"
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
						</Box>
						<Text
							px={2}
							pt={1.5}
							fontSize="xs"
							fontFamily="mono"
							color="ink.muted"
							textAlign="center"
							truncate
						>
							{item.name}
						</Text>
						<Button
							size="xs"
							variant="ghost"
							color="ink.muted"
							disabled={isPending}
							onClick={() => onRemove(item.fileid)}
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
