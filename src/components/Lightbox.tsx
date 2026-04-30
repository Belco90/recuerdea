import type { YearGroup } from '#/lib/memory-grouping'

import {
	Box,
	Carousel,
	Dialog,
	HStack,
	IconButton,
	Image,
	Portal,
	Text,
	VStack,
} from '@chakra-ui/react'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'

type LightboxProps = {
	group: YearGroup
	startIndex: number
	open: boolean
	onClose: () => void
}

function yearsAgoLowercase(n: number): string {
	if (n === 0) return 'hoy mismo'
	if (n === 1) return 'hace un año'
	return `hace ${n} años`
}

function captionFromName(name: string): string {
	const stem = name.replace(/\.[^.]+$/, '')
	return stem.replace(/[_-]+/g, ' ').trim()
}

export function Lightbox({ group, startIndex, open, onClose }: LightboxProps) {
	const [idx, setIdx] = useState(startIndex)

	useEffect(() => {
		if (open) setIdx(startIndex)
	}, [open, startIndex])

	const items = group.items
	const item = items[idx]

	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'ArrowRight') {
				e.preventDefault()
				setIdx((i) => Math.min(items.length - 1, i + 1))
			} else if (e.key === 'ArrowLeft') {
				e.preventDefault()
				setIdx((i) => Math.max(0, i - 1))
			}
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [open, items.length])

	if (!item) return null

	const caption = captionFromName(item.name)
	const downloadHref = `/api/memory/${item.uuid}?variant=image`

	return (
		<Dialog.Root
			open={open}
			onOpenChange={({ open: o }) => {
				if (!o) onClose()
			}}
			size="full"
		>
			<Portal>
				<Dialog.Backdrop bg="rgba(12,9,6,0.94)" backdropFilter="blur(16px)" />
				<Dialog.Positioner>
					<Dialog.Content
						bg="transparent"
						boxShadow="none"
						display="flex"
						flexDirection="column"
						h="100vh"
						maxW="100vw"
						color="white"
					>
						<HStack justify="space-between" align="center" px={4.5} py={3.5} color="whiteAlpha.85">
							<HStack
								gap={2.5}
								fontFamily="mono"
								fontSize="12px"
								letterSpacing="0.08em"
								textTransform="uppercase"
							>
								<Box as="span" color="white" fontWeight={600}>
									{group.year}
								</Box>
								<Box as="span" opacity={0.4}>
									·
								</Box>
								<Box as="span" opacity={0.65}>
									{yearsAgoLowercase(group.yearsAgo)}
								</Box>
							</HStack>
							<HStack gap={2.5}>
								<Box
									as="span"
									fontFamily="mono"
									fontSize="12px"
									letterSpacing="0.08em"
									opacity={0.7}
								>
									{idx + 1} / {items.length}
								</Box>
								<IconButton asChild variant="ghost" size="sm" aria-label="Descargar">
									<a href={downloadHref} download target="_blank" rel="noopener noreferrer">
										<Download size={18} aria-hidden />
									</a>
								</IconButton>
								<Dialog.CloseTrigger asChild>
									<IconButton variant="ghost" size="sm" aria-label="Cerrar">
										<X size={18} aria-hidden />
									</IconButton>
								</Dialog.CloseTrigger>
							</HStack>
						</HStack>

						<Carousel.Root
							slideCount={items.length}
							page={idx}
							onPageChange={({ page }) => setIdx(page)}
							slidesPerPage={1}
							loop={false}
							allowMouseDrag
							snapType="mandatory"
							flex={1}
							display="flex"
							flexDirection="column"
							minH={0}
						>
							<Box flex={1} position="relative" minH={0}>
								<Carousel.ItemGroup h="full">
									{items.map((it, i) => (
										<Carousel.Item
											key={it.uuid}
											index={i}
											display="flex"
											alignItems="center"
											justifyContent="center"
											px={3}
											h="full"
										>
											{it.kind === 'video' ? (
												<video
													src={`/api/memory/${it.uuid}?variant=stream`}
													poster={`/api/memory/${it.uuid}?variant=poster`}
													controls
													autoPlay={i === idx}
													preload={i === idx ? 'metadata' : 'none'}
													style={{
														maxWidth: '100%',
														maxHeight: '100%',
														objectFit: 'contain',
														borderRadius: '2px',
														background: '#000',
													}}
												>
													<track kind="captions" />
												</video>
											) : (
												<Image
													src={`/api/memory/${it.uuid}?variant=image`}
													alt={captionFromName(it.name) || 'Recuerdo'}
													maxW="full"
													maxH="full"
													objectFit="contain"
													borderRadius="2px"
													bg="black"
													draggable={false}
												/>
											)}
										</Carousel.Item>
									))}
								</Carousel.ItemGroup>

								<Carousel.PrevTrigger asChild>
									<IconButton
										position="absolute"
										left={3.5}
										top="50%"
										transform="translateY(-50%)"
										w="44px"
										h="44px"
										minW="44px"
										borderRadius="full"
										bg="whiteAlpha.100"
										color="white"
										_hover={{ bg: 'whiteAlpha.300' }}
										_disabled={{ opacity: 0, pointerEvents: 'none' }}
										display={{ base: 'none', md: 'inline-flex' }}
										aria-label="Anterior"
									>
										<ChevronLeft size={20} aria-hidden />
									</IconButton>
								</Carousel.PrevTrigger>
								<Carousel.NextTrigger asChild>
									<IconButton
										position="absolute"
										right={3.5}
										top="50%"
										transform="translateY(-50%)"
										w="44px"
										h="44px"
										minW="44px"
										borderRadius="full"
										bg="whiteAlpha.100"
										color="white"
										_hover={{ bg: 'whiteAlpha.300' }}
										_disabled={{ opacity: 0, pointerEvents: 'none' }}
										display={{ base: 'none', md: 'inline-flex' }}
										aria-label="Siguiente"
									>
										<ChevronRight size={20} aria-hidden />
									</IconButton>
								</Carousel.NextTrigger>
							</Box>

							<VStack gap={2.5} px={4.5} py={5} color="whiteAlpha.85" textAlign="center">
								{caption && (
									<Text fontFamily="handwriting" fontSize="22px" fontWeight={500} m={0}>
										{caption}
									</Text>
								)}
								<Carousel.IndicatorGroup gap={1.5}>
									{items.map((it, i) => (
										<Carousel.Indicator
											key={it.uuid}
											index={i}
											aria-label={`Ir al recuerdo ${i + 1}`}
											css={{
												width: '6px',
												height: '6px',
												borderRadius: '9999px',
												background: 'var(--chakra-colors-whiteAlpha-300)',
												border: 0,
												padding: 0,
												cursor: 'pointer',
												transition: 'background 0.15s, transform 0.15s',
												'&[data-current]': {
													background: 'var(--chakra-colors-accent-500)',
													transform: 'scale(1.3)',
												},
											}}
										/>
									))}
								</Carousel.IndicatorGroup>
							</VStack>
						</Carousel.Root>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	)
}
