export default {
  plugins: {
    // v4 moved the PostCSS plugin into its own package. `autoprefixer` is
    // included by that plugin now, so listing it again would be redundant.
    '@tailwindcss/postcss': {},
  },
};
