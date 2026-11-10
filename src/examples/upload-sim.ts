import type { FileUploader } from '../lib/upload'

/** A pretend uploader for the showcase: progress in random steps every 70 ms, no network. Stops when the row is removed. */
export const fakeUpload: FileUploader = (_file, onProgress, { signal }) => new Promise((resolve, reject) => {
  let p = 0
  const t = setInterval(() => {
    p = Math.min(100, p + 3 + Math.random() * 9); onProgress(p)
    if (p >= 100) { clearInterval(t); resolve() }
  }, 70)
  signal.addEventListener('abort', () => { clearInterval(t); reject(signal.reason) }, { once: true })
})
