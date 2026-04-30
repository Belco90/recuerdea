import type { MemoryItem } from '#/lib/memories/pcloud.server'

import { rotForKey } from '#/lib/utils/rotation'
import { Box, HStack, Image, Text } from '@chakra-ui/react'
import { Play } from 'lucide-react'

type PolaroidProps = {
	item: MemoryItem
	keyId: string
	onClick: () => void
}

export function Polaroid({ item, keyId, onClick }: PolaroidProps) {
	const rot = rotForKey(keyId)
	const caption = item.place
	const aspectRatio = item.width && item.height ? item.width / item.height : undefined
	const photoSrc =
		item.kind === 'video'
			? `/api/memory/${item.uuid}?variant=poster`
			: `/api/memory/${item.uuid}?variant=image`

	return (
		<Box
			as="button"
			w="full"
			p={0}
			border={0}
			bg="transparent"
			display="block"
			mb={4.5}
			transform={`rotate(${rot}deg)`}
			transition="transform 0.25s cubic-bezier(.2,.7,.3,1)"
			_hover={{
				transform: 'rotate(0deg) translateY(-3px)',
				'& > div': { boxShadow: 'rdShadowLift' },
			}}
			_active={{ transform: 'rotate(0deg) translateY(-1px) scale(0.99)' }}
			css={{ breakInside: 'avoid' }}
			onClick={onClick}
			aria-label={caption ?? 'Recuerdo'}
		>
			<Box
				bg="paper"
				pl={2}
				pr={2}
				pt={2}
				pb={7}
				borderRadius="2px"
				boxShadow="rdShadow"
				position="relative"
				transition="box-shadow 0.25s cubic-bezier(.2,.7,.3,1)"
			>
				<Box position="relative" bg="bg.muted" overflow="hidden" w="full" aspectRatio={aspectRatio}>
					<Image
						src={photoSrc}
						alt=""
						loading="lazy"
						w="full"
						h="full"
						objectFit="cover"
						filter="saturate(0.92) contrast(1.02)"
					/>
					{item.kind === 'video' && (
						<HStack
							position="absolute"
							bottom="7px"
							left="7px"
							bg="blackAlpha.600"
							color="white"
							px={2}
							py={0.5}
							borderRadius="full"
							fontSize="10.5px"
							fontFamily="mono"
							gap={1.25}
							backdropFilter="blur(4px)"
						>
							<Play size={10} fill="currentColor" />
							<Box as="span" letterSpacing="0.04em">
								VÍDEO
							</Box>
						</HStack>
					)}
				</Box>
				{caption && (
					<Text
						mt={2}
						fontFamily="handwriting"
						fontSize="17px"
						fontWeight={500}
						textAlign="center"
						color="ink"
						lineHeight="1.1"
						px={1}
					>
						{caption}
					</Text>
				)}
			</Box>
		</Box>
	)
}
