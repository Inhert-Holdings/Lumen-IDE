/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0c1017",
        panel: "#111824",
        border: "#1d2633",
        text: "#d8e1ee",
        muted: "#8b99ad",
        accent: "#4ac8ff",
        good: "#34d399",
        bad: "#fb7185",
        warn: "#fbbf24"
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"]
      }
    }
  },
  plugins: []
};
