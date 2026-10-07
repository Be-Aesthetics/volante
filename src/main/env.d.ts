// Vite inlines these imports as data: URLs.
declare module '*?inline' {
  const src: string
  export default src
}
