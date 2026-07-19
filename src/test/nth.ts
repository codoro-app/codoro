/**
 * Indexed array access that throws instead of returning `T | undefined`
 * (this repo's `noUncheckedIndexedAccess` + `no-non-null-assertion` lint
 * rule mean `arr[i]!` isn't available) — for tests that need "the Nth
 * rendered element" without a null check cluttering the assertion.
 */
export function nth<T>(arr: readonly T[], index: number): T {
  const value = arr[index]
  if (value === undefined) {
    throw new Error(
      `Expected an element at index ${String(index)}, array has length ${String(arr.length)}`,
    )
  }
  return value
}
