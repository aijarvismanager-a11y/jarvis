/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#FBF9F5",
        panel: "#FFFFFF",
        sidebar: "#F6F2EA",
        border: "#E9E4D9",
        borderSoft: "#EFEAE0",
        ink: "#2B2A26",
        muted: "#8A8578",
        accent: {
          DEFAULT: "#B5563A",
          hover: "#8C4029",
        },
        status: {
          done: "#3F6B52",
          pending: "#8A8578",
        },
      },
      fontFamily: {
        serif: ["Source Serif 4", "serif"],
        sans: ["Public Sans", "system-ui", "sans-serif"],
        mono: ["SFMono-Regular", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
