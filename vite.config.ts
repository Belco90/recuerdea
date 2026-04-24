import netlify from '@netlify/vite-plugin-tanstack-start'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [devtools(), netlify(), tanstackStart(), viteReact()],
})

export default config
