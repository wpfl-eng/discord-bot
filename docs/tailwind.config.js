/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				dark: {
					50: '#f5f5f6',
					100: '#e6e6e7',
					200: '#d0d0d2',
					300: '#afb0b3',
					400: '#86878c',
					500: '#6b6c71',
					600: '#5b5c60',
					700: '#4d4e51',
					800: '#434446',
					900: '#3b3c3e',
					950: '#27282a',
					bg: '#1e1f22',
					sidebar: '#2b2d31',
					card: '#313338',
					hover: '#404249',
					border: '#3f4147'
				},
				accent: {
					primary: '#5865f2',
					'primary-hover': '#4752c4',
					success: '#2ecc71',
					warning: '#f1c40f',
					danger: '#e74c3c',
					info: '#3498db'
				}
			},
			fontFamily: {
				sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
				mono: ['JetBrains Mono', 'Fira Code', 'monospace']
			},
			typography: {
				DEFAULT: {
					css: {
						maxWidth: 'none',
						color: '#e6e6e7',
						a: {
							color: '#5865f2',
							'&:hover': {
								color: '#4752c4'
							}
						},
						code: {
							color: '#e6e6e7',
							backgroundColor: '#313338',
							padding: '0.25rem 0.5rem',
							borderRadius: '0.25rem',
							fontWeight: '400'
						},
						'code::before': {
							content: '""'
						},
						'code::after': {
							content: '""'
						}
					}
				}
			}
		}
	},
	plugins: [require('@tailwindcss/typography')]
};
