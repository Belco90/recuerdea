import type { YearGroup } from '#/lib/memory-grouping'

import { Box, Dialog, HStack, IconButton, Image, Portal, Text, VStack } from '@chakra-ui/react'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

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
	const touchStartX = useRef<number | null>(null)

	useEffect(() => {
		if (open) setIdx(startIndex)
	}, [open, startIndex])

	const items = group.items
	const item = items[idx]

	const next = useCallback(() => setIdx((i) => Math.min(items.length - 1, i + 1)), [items.length])
	const prev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), [])

	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'ArrowRight') next()
			else if (e.key === 'ArrowLeft') prev()
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [open, next, prev])

	if (!item) return null

	const onTouchStart = (e: React.TouchEvent) => {
		touchStartX.current = e.touches[0]!.clientX
	}
	const onTouchEnd = (e: React.TouchEvent) => {
		if (touchStartX.current == null) return
		const dx = e.changedTouches[0]!.clientX - touchStartX.current
		if (dx > 50) prev()
		else if (dx < -50) next()
		touchStartX.current = null
	}

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
									<a href={downloadHref} download target="_blank" rel="noopener">
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

						<Box
							flex={1}
							position="relative"
							display="flex"
							alignItems="center"
							justifyContent="center"
							px={3}
							overflow="hidden"
							onTouchStart={onTouchStart}
							onTouchEnd={onTouchEnd}
						>
							{item.kind === 'video' ? (
								<video
									key={item.uuid}
									src={`/api/memory/${item.uuid}?variant=stream`}
									poster={`/api/memory/${item.uuid}?variant=poster`}
									controls
									autoPlay
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
									key={item.uuid}
									src={`/api/memory/${item.uuid}?variant=image`}
									alt={caption || 'Recuerdo'}
									maxW="full"
									maxH="full"
									objectFit="contain"
									borderRadius="2px"
									bg="black"
								/>
							)}

							{idx > 0 && (
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
									display={{ base: 'none', md: 'inline-flex' }}
									onClick={prev}
									aria-label="Anterior"
								>
									<ChevronLeft size={20} aria-hidden />
								</IconButton>
							)}
							{idx < items.length - 1 && (
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
									display={{ base: 'none', md: 'inline-flex' }}
									onClick={next}
									aria-label="Siguiente"
								>
									<ChevronRight size={20} aria-hidden />
								</IconButton>
							)}
						</Box>

						<VStack gap={2.5} px={4.5} py={5} color="whiteAlpha.85" textAlign="center">
							{caption && (
								<Text fontFamily="handwriting" fontSize="22px" fontWeight={500} m={0}>
									{caption}
								</Text>
							)}
							<HStack gap={1.5} role="tablist" aria-label="Recuerdos del año">
								{items.map((it, i) => (
									<Box
										key={it.uuid}
										w="6px"
										h="6px"
										borderRadius="full"
										bg={i === idx ? 'accent.500' : 'whiteAlpha.300'}
										transform={i === idx ? 'scale(1.3)' : undefined}
										transition="background 0.15s, transform 0.15s"
									/>
								))}
							</HStack>
						</VStack>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	)
}
