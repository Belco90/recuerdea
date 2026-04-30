import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const PAPER_NOISE_LIGHT = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.6' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.55  0 0 0 0 0.42  0 0 0 0 0.25  0 0 0 0.045 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>")`

const PAPER_NOISE_DARK = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.6' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 0.92  0 0 0 0 0.78  0 0 0 0.04 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>")`

const config = defineConfig({
	globalCss: {
		'*': { boxSizing: 'border-box' },
		'html, body': { margin: 0, padding: 0 },
		body: {
			fontFamily: 'body',
			color: 'ink',
			background: 'bg',
			backgroundImage: {
				_light: `radial-gradient(1100px 600px at 80% -10%, color-mix(in srgb, {colors.accent.500} 7%, transparent), transparent 60%), radial-gradient(900px 500px at -10% 110%, color-mix(in srgb, {colors.accent.500} 5%, transparent), transparent 60%), ${PAPER_NOISE_LIGHT}`,
				_dark: `radial-gradient(1100px 600px at 80% -10%, color-mix(in srgb, {colors.accent.500} 14%, transparent), transparent 60%), radial-gradient(900px 500px at -10% 110%, color-mix(in srgb, {colors.accent.500} 10%, transparent), transparent 60%), ${PAPER_NOISE_DARK}`,
			},
			backgroundBlendMode: 'normal, normal, multiply',
		},
		'img, video': { display: 'block', maxWidth: '100%' },
		button: { fontFamily: 'inherit', cursor: 'pointer' },
	},
	theme: {
		breakpoints: {
			// `md` overridden to 720px to match the prototype's media-query breakpoint.
			sm: '30em',
			md: '45em',
			lg: '62em',
			xl: '80em',
			'2xl': '96em',
		},
		tokens: {
			fonts: {
				body: {
					value: "'Inter', -apple-system, system-ui, sans-serif",
				},
				heading: {
					value: "'Fraunces', 'Newsreader', Georgia, serif",
				},
				mono: {
					value: "'JetBrains Mono', ui-monospace, monospace",
				},
				handwriting: {
					value: "'Caveat', 'Patrick Hand', cursive",
				},
			},
			colors: {
				accent: {
					50: { value: '#FBF1EA' },
					100: { value: '#F6DDCB' },
					200: { value: '#EDB89A' },
					300: { value: '#E29368' },
					400: { value: '#D17542' },
					500: { value: '#B8552E' },
					600: { value: '#9C4424' },
					700: { value: '#7C361E' },
					800: { value: '#5C2818' },
					900: { value: '#3D1B11' },
					950: { value: '#1F0E08' },
				},
			},
			shadows: {
				polaroid: {
					value: '0 1px 1px rgba(50,30,10,.08), 0 8px 18px -8px rgba(50,30,10,.18)',
				},
				polaroidLift: {
					value: '0 2px 2px rgba(50,30,10,.10), 0 18px 32px -10px rgba(50,30,10,.28)',
				},
				polaroidDark: {
					value: '0 1px 1px rgba(0,0,0,.4), 0 8px 18px -8px rgba(0,0,0,.6)',
				},
				polaroidLiftDark: {
					value: '0 2px 2px rgba(0,0,0,.5), 0 18px 32px -10px rgba(0,0,0,.7)',
				},
			},
		},
		semanticTokens: {
			colors: {
				bg: {
					value: { _light: '#f3ead8', _dark: '#1a160f' },
				},
				'bg.muted': {
					value: { _light: '#ece1cc', _dark: '#221c13' },
				},
				paper: {
					value: { _light: '#fbf6ec', _dark: '#2a2218' },
				},
				ink: {
					value: { _light: '#2a2014', _dark: '#f0e6d2' },
				},
				'ink.muted': {
					value: { _light: '#6b5a45', _dark: '#a89880' },
				},
				line: {
					value: { _light: '#ddd0b6', _dark: '#3a2f22' },
				},
				'accent.soft': {
					value: { _light: '#ecdfc8', _dark: '#2e2418' },
				},
			},
			shadows: {
				rdShadow: {
					value: { _light: '{shadows.polaroid}', _dark: '{shadows.polaroidDark}' },
				},
				rdShadowLift: {
					value: { _light: '{shadows.polaroidLift}', _dark: '{shadows.polaroidLiftDark}' },
				},
			},
		},
		keyframes: {
			rdShimmer: {
				'0%': { backgroundPosition: '100% 0' },
				'100%': { backgroundPosition: '-100% 0' },
			},
			rdPulse: {
				'0%, 100%': {
					boxShadow: '0 0 0 3px color-mix(in srgb, {colors.accent.500} 25%, transparent)',
				},
				'50%': {
					boxShadow: '0 0 0 5px color-mix(in srgb, {colors.accent.500} 10%, transparent)',
				},
			},
			rdFade: {
				from: { opacity: '0' },
				to: { opacity: '1' },
			},
			rdZoom: {
				from: { opacity: '0', transform: 'scale(.97)' },
				to: { opacity: '1', transform: 'none' },
			},
		},
	},
})

export const system = createSystem(defaultConfig, config)
