import type { Config } from "tailwindcss";
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Inter'", "system-ui", "sans-serif"],
        serif: ["'Noto Serif TC'", "'STSong'", "serif"],
      },
      colors: {
        gold: {
          DEFAULT: "#c9a96e",
          light:   "#d4b87a",
          muted:   "#c9a96e99",
          dim:     "#c9a96e33",
        },
        surface: {
          DEFAULT: "#161310",
          dark:    "#0c0a07",
          card:    "#1a1612",
          hover:   "#201d17",
          border:  "#2a2418",
        },
      },
    },
  },
  plugins: [],
};
export default config;
