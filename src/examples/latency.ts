/**
 * A fake API call for demos: waits `ms` (or a random time in `[min, max]`), then resolves `result()`, or rejects with
 * what it throws. Rejects with an AbortError as soon as `signal` aborts, like `fetch`.
 */
export function fakeLatency<T>(signal: AbortSignal | undefined, ms: number | readonly [min: number, max: number], result: () => T): Promise<T> {
  const wait = typeof ms === 'number' ? ms : ms[0] + Math.random() * (ms[1] - ms[0])
  return new Promise<T>((resolve, reject) => {
    const aborted = () => new DOMException('Aborted', 'AbortError')
    if (signal?.aborted) { reject(aborted()); return }
    const onAbort = () => { clearTimeout(t); reject(aborted()) }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      try { resolve(result()) } catch (e) { reject(e) }
    }, wait)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
