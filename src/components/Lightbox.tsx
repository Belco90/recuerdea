import type { YearGroup } from '#/lib/memories/memory-grouping'

import { Box, Carousel, Dialog, HStack, IconButton, Image, Portal, VStack } from '@chakra-ui/react'
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

function getDownloadHref(itemId: string): string {
	return `/api/memory/${itemId}?variant=image`
}

export function Lightbox({ group, startIndex, open, onClose }: LightboxProps) {
	const [idx, setIdx] = useState(startIndex)

	useEffect(() => {
		if (open) setIdx(startIndex)
	}, [open, startIndex])

	const items = group.items
	const item = items[idx]

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
								<IconButton
									asChild
									variant="ghost"
									size="2xs"
									aria-label="Descargar"
									color="white"
									shadow="md"
								>
									<a
										href={getDownloadHref(item.uuid)}
										download
										target="_blank"
										rel="noopener noreferrer"
									>
										<Download size={18} aria-hidden />
									</a>
								</IconButton>
							</HStack>
							<HStack gap="2" flex="1" justify="center">
								<Box
									as="span"
									fontFamily="mono"
									fontSize="12px"
									letterSpacing="0.08em"
									opacity={0.7}
								>
									{idx + 1} / {items.length}
								</Box>
								<Dialog.CloseTrigger asChild display="flex">
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
							gap={0}
							minH={0}
							position="relative"
						>
							<Carousel.ItemGroup flex={1} minH={0}>
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
												alt={it.name || 'Recuerdo'}
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

							<Carousel.Control
								position="absolute"
								inset={0}
								pointerEvents="none"
								justifyContent="space-between"
								px={3.5}
								display={{ base: 'none', md: 'flex' }}
							>
								<Carousel.PrevTrigger asChild>
									<IconButton
										w="44px"
										h="44px"
										minW="44px"
										borderRadius="full"
										bg="whiteAlpha.100"
										color="white"
										pointerEvents="auto"
										_hover={{ bg: 'whiteAlpha.300' }}
										_disabled={{ opacity: 0, pointerEvents: 'none' }}
										aria-label="Anterior"
									>
										<ChevronLeft size={20} aria-hidden />
									</IconButton>
								</Carousel.PrevTrigger>
								<Carousel.NextTrigger asChild>
									<IconButton
										w="44px"
										h="44px"
										minW="44px"
										borderRadius="full"
										bg="whiteAlpha.100"
										color="white"
										pointerEvents="auto"
										_hover={{ bg: 'whiteAlpha.300' }}
										_disabled={{ opacity: 0, pointerEvents: 'none' }}
										aria-label="Siguiente"
									>
										<ChevronRight size={20} aria-hidden />
									</IconButton>
								</Carousel.NextTrigger>
							</Carousel.Control>

							<VStack gap={2.5} px={4.5} py={5} textAlign="center">
								<Carousel.IndicatorGroup gap={1.5}>
									{items.map((it, i) => (
										<Carousel.Indicator
											key={it.uuid}
											index={i}
											aria-label={`Ir al recuerdo ${i + 1}`}
											w="6px"
											h="6px"
											minW="6px"
											borderRadius="full"
											bg="whiteAlpha.400"
											border={0}
											p={0}
											cursor="pointer"
											transition="background 0.15s, transform 0.15s"
											_current={{ bg: 'accent.500', transform: 'scale(1.3)' }}
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
