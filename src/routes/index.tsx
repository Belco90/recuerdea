import { createFileRoute } from '@tanstack/react-router'
import { Box, Heading, Text, Code } from '@chakra-ui/react'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <Box p={8}>
      <Heading size="2xl">Welcome to TanStack Start</Heading>
      <Text mt={4} fontSize="lg">
        Edit <Code>src/routes/index.tsx</Code> to get started.
      </Text>
    </Box>
  )
}
