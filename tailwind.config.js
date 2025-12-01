/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/frontend/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#3b82f6',
          dark: '#2563eb',
        },
        dark: {
          DEFAULT: '#1a1a1a',
          lighter: '#2a2a2a',
          border: '#3a3a3a',
        }
      }
    },
  },
  plugins: [],
}
