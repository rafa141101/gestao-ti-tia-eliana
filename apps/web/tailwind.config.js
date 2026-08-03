/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f6fe', 100: '#dceafd', 200: '#c0dbfb', 300: '#95c4f8',
          400: '#63a4f2', 500: '#3f83ec', 600: '#2a66e0', 700: '#2251ce',
          800: '#2143a7', 900: '#203c84', 950: '#182651',
        },
      },
    },
  },
  plugins: [],
};
