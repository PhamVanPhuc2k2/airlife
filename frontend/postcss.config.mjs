// Tailwind 3 chạy như một plugin PostCSS. autoprefixer thêm tiền tố -webkit- … cho trình duyệt cũ.
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
