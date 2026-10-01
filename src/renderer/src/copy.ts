// Headline voice. Everything else in the UI is shared plain English.

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

export const copy = {
  routerDown: 'The router is offline.',
  empty: 'Add your first server.',
  attention: (n: number): string => `${n} ${plural(n, 'server needs', 'servers need')} attention.`,
  allOpen: 'Everything is running.',
  starting: 'Starting your servers.',
  quiet: 'No activity yet'
}
