import { theme } from './src/styles/theme.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tally: theme.colors
      },
      fontFamily: {
        sans: theme.fonts.sans,
        mono: theme.fonts.mono
      },
      boxShadow: {
        panel: theme.shadow.panel
      }
    }
  },
  plugins: []
};
