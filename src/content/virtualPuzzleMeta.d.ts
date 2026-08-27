declare module 'virtual:codoro-puzzle-meta' {
  export const PUZZLE_META: readonly {
    id: string
    pattern: string
    difficulty_rating: number
    interaction: string
  }[]
}
