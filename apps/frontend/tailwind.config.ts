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
    },
  },
  plugins: [],
}
export default config
