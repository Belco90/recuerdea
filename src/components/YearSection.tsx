import type { YearGroup } from '#/lib/memories/memory-grouping'

import { Polaroid } from '#/components/Polaroid'
import { yearsAgo } from '#/lib/utils/years-ago'
import { Box, Heading, SimpleGrid, Text } from '@chakra-ui/react'

type YearSectionProps = {
	group: YearGroup
	onOpen: (year: number, idx: number) => void
}

export function YearSection({ group, onOpen }: YearSectionProps) {
	const count = group.items.length

	return (
		<Box as="section" position="relative" pl={{ base: 12, md: '130px' }} mb={14}>
			<Box position="absolute" left={0} top={1} aria-hidden>
				<Box
					position="absolute"
					left={{ base: '14px', md: '86px' }}
					top="11px"
					w="11px"
					h="11px"
					borderRadius="full"
					bg="accent.500"
					boxShadow="0 0 0 4px var(--chakra-colors-bg), 0 0 0 5px var(--chakra-colors-line)"
				/>
				<Text
					display={{ base: 'none', md: 'block' }}
					fontFamily="mono"
					fontSize="13px"
					fontWeight={600}
					color="ink"
					letterSpacing="0.06em"
					textAlign="right"
					w="64px"
					pt={1}
				>
					{group.year}
				</Text>
			</Box>
			<Heading
				as="h2"
				fontFamily="heading"
				fontWeight={400}
				fontStyle="italic"
				fontSize={{ base: 'clamp(22px, 4.6vw, 32px)' }}
				letterSpacing="-0.015em"
				color="ink"
				m={0}
				_firstLetter={{ textTransform: 'uppercase' }}
			>
				{yearsAgo(group.yearsAgo)}
			</Heading>
			<Text
				fontFamily="mono"
				fontSize="11px"
				letterSpacing="0.08em"
				textTransform="uppercase"
				color="ink.muted"
				mt={1}
				mb={4.5}
			>
				{count} {count === 1 ? 'recuerdo' : 'recuerdos'}
			</Text>
			<SimpleGrid
				columns={{ base: 2, md: 3, lg: 4 }}
				gap={{ base: 3.5, md: 4.5 }}
				alignItems="start"
			>
				{group.items.map((item, idx) => (
					<Polaroid
						key={item.uuid}
						item={item}
						keyId={`${group.year}-${idx}`}
						onClick={() => onOpen(group.year, idx)}
					/>
				))}
			</SimpleGrid>
		</Box>
	)
}
