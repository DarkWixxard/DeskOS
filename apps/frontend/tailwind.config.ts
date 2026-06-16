import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        dark: '#0f0f0f',
        darker: '#1a1a1a',
        accent: '#00d9ff',
        success: '#00ff88',
        warning: '#ffa500',
        danger: '#ff0055',
      },
      boxShadow: {
        glow: '0 0 20px rgba(0, 217, 255, 0.35)',
        'glow-sm': '0 0 10px rgba(0, 217, 255, 0.3)',
        'glow-lg': '0 0 40px rgba(0, 217, 255, 0.4)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
export default config
