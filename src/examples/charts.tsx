/* Demo-only statistics helper: the showcase's forest plot derives its error bars from raw samples with it. */

/** Mean, standard deviation (n − 1) and standard error of a sample. */
export const describeSample = (a: number[]) => {
  const n = a.length, mean = a.reduce((s, x) => s + x, 0) / n
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1))
  return { n, mean, sd, se: sd / Math.sqrt(n) }
}
