/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          idle: '#1d4ed8',
          listen: '#06b6d4',
          speak: '#3b82f6',
          warn: '#f97316'
        }
      },
      animation: {
        'blob': 'blob 10s infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'energy-ring': 'energy-ring 3s infinite alternate',
        'energy-core': 'energy-core 1.5s ease-in-out infinite alternate',
      },
      keyframes: {
        blob: {
          '0%': { transform: 'translate(0px, 0px) scale(1)' },
          '33%': { transform: 'translate(30px, -50px) scale(1.1)' },
          '66%': { transform: 'translate(-20px, 20px) scale(0.9)' },
          '100%': { transform: 'translate(0px, 0px) scale(1)' },
        },
        'energy-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.5', filter: 'blur(2px)' },
          '100%': { transform: 'scale(1.2)', opacity: '0.8', filter: 'blur(8px)' }
        },
        'energy-core': {
          '0%': { transform: 'scale(0.85)', filter: 'drop-shadow(0 0 15px currentColor)' },
          '100%': { transform: 'scale(1.05)', filter: 'drop-shadow(0 0 40px currentColor)' }
        }
      }
    },
  },
  plugins: [],
}
