import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { type FormControlProps, useFormControl, Icon, IconButton, cn, spring, plural, fmt, composeRefs } from './core'
import { play } from './motion'
import { Progress } from './feedback'

type FormsFile = { id: number; name: string; size: number; file?: File }
let formsFileSeq = 0
type FormsUploader = (file: File, onProgress: (pct: number) => void) => Promise<void>

function FormsFileRow({ f, upload, onRemove }: { f: FormsFile; upload?: FormsUploader; onRemove: () => void }) {
  const lf = fmt
  const [pct, setPct] = useState(0)
  const [failed, setFailed] = useState(false)
  const uploader = useRef(upload) // latest uploader without restarting: an inline `upload` prop changes identity every render
  useLayoutEffect(() => { uploader.current = upload })
  useEffect(() => {
    let live = true
    const run = uploader.current
    if (run && f.file) {
      run(f.file, p => { if (live) setPct(Math.min(99, p)) }).then(() => { if (live) setPct(100) }, () => { if (live) setFailed(true) })
      return () => { live = false }
    }
    let p = 0 // no uploader given: simulate one so the row shows real progress
    const t = setInterval(() => { p = Math.min(100, p + 3 + Math.random() * 9); setPct(p); if (p >= 100) clearInterval(t) }, 70)
    return () => { live = false; clearInterval(t) }
  }, [f.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = pct >= 100, size = f.size ? lf.bytes(f.size) : ''
  return (
    <motion.div layout="position" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0, x: 20, transition: { opacity: { duration: 0.15 }, x: { duration: 0.15 }, height: { duration: 0.18, delay: 0.12 } } }}
      transition={spring(0.2, 0.35)} className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] py-2 text-[13px]">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[var(--r-md)] bg-[var(--muted)] font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg2)] uppercase">{(f.name.split('.').pop() || 'file').slice(0, 4)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{f.name}</span>
          <span className={cn('block text-xs transition-colors', done ? 'text-[var(--ok)]' : failed ? 'text-[var(--bad)]' : 'text-[var(--fg3)]')} aria-live="polite">{size && `${size} · `}{done ? 'Uploaded' : failed ? 'Upload failed' : `Uploading ${lf.percent(Math.round(pct) / 100)}`}</span>
          <Progress value={pct} tone={done ? 'ok' : failed ? 'bad' : 'primary'} label={`Upload of ${f.name}`} className="mt-1 !h-1" />
        </span>
        <IconButton icon="x" label={`Remove ${f.name}`} onClick={onRemove} />
      </div>
    </motion.div>
  )
}

/**
 * True when `file` matches an `accept` string like the file input's: extensions ('.pdf'), MIME types ('application/pdf')
 * and wildcards ('image/*'), comma-separated. An empty `accept` accepts everything. This checks the name and the type
 * the browser reports, both of which the user controls: it is a convenience, not validation.
 */
export function fileAccepts(file: { name: string; type: string }, accept?: string) {
  const rules = (accept ?? '').split(',').map(r => r.trim().toLowerCase()).filter(Boolean)
  if (!rules.length) return true
  const name = file.name.toLowerCase(), type = (file.type || '').toLowerCase()
  return rules.some(r => r.startsWith('.') ? name.endsWith(r) : r.endsWith('/*') ? type.startsWith(r.slice(0, -1)) : type === r)
}

/**
 * Drop zone + file list. Each file shows a progress bar and "Uploading → Uploaded"; removed rows slide out and collapse.
 * Pass `upload(file, onProgress)` to upload for real (otherwise progress is simulated) and `defaultFiles` to seed the list.
 * Dropped and picked files are filtered by `accept` (and to one file without `multiple`); skipped ones go to `onReject`
 * and a note under the zone. `accept` only checks the name and reported type: validate type, size and content on the server.
 * Form-native: with `name`, the files in the list (picked or dropped) are submitted as a native file field (multipart
 * FormData / server actions; `defaultFiles` have no content and aren't sent); `required` (at least one file), `disabled`,
 * `invalid`, `onBlur`, `form`, and `ref` on the drop zone. Reset restores `defaultFiles`.
 */
export function FileUpload({ onFiles, onReject, accept, multiple = true, hint, defaultFiles = [], upload, className, name, ref, ...fp }: Omit<FormControlProps, 'readOnly'> &
  { onFiles?: (f: File[]) => void; /** files dropped or picked that don't match `accept` */ onReject?: (f: File[]) => void; accept?: string; multiple?: boolean; hint?: string; defaultFiles?: { name: string; size: number }[]
    /** upload one file for real, reporting 0–100 progress; a rejected promise marks the row failed */ upload?: FormsUploader; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const [files, setFiles] = useState<FormsFile[]>(() => defaultFiles.map(f => ({ ...f, id: ++formsFileSeq })))
  const [over, setOver] = useState(false)
  const [skipped, setSkipped] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null), zone = useRef<HTMLButtonElement>(null)
  const fc = useFormControl<number>({ ...fp, value: files.length, defaultValue: defaultFiles.length, serialize: () => null, filled: n => n > 0, focus: () => zone.current?.focus(),
    onReset: () => { setFiles(defaultFiles.map(f => ({ ...f, id: ++formsFileSeq }))); setSkipped(null) } })
  const fieldName = name ?? fc.field?.name
  useEffect(() => { // the native file input carries the list, so the form submits the files
    const el = input.current
    if (!el || !fieldName || typeof DataTransfer === 'undefined') return
    try { const dt = new DataTransfer(); files.forEach(f => { if (f.file) dt.items.add(f.file) }); el.files = dt.files } catch { /* very old browsers: nothing to submit */ }
  }, [files, fieldName])
  const add = (list: FileList | null) => {
    if (!list?.length || fc.disabled) return
    const all = [...list], ok = all.filter(f => fileAccepts(f, accept)), bad = all.filter(f => !ok.includes(f))
    const f = multiple ? ok : ok.slice(0, 1)
    setSkipped(bad.length ? `${bad.length === 1 ? `“${bad[0].name}” isn’t an accepted type` : `${plural(bad.length, 'file isn’t', 'files aren’t')} an accepted type`}${accept ? ` (${accept})` : ''}` : null)
    if (bad.length) onReject?.(bad)
    if (!f.length) return
    fc.set(files.length + f.length) // marks a user edit: the form hears input/change
    setFiles(x => [...f.map(file => ({ id: ++formsFileSeq, name: file.name, size: file.size, file })).reverse(), ...x]); onFiles?.(f)
  }
  return (
    <div className={cn('relative flex flex-col', className)} onBlur={fc.onBlur}>
      <motion.button ref={composeRefs(zone, ref)} type="button" {...fc.control} disabled={fc.disabled} animate={{ scale: over ? 1.02 : 1 }} transition={spring(0.3, 0.3)} onClick={() => input.current?.click()}
        onDragOver={e => { e.preventDefault(); if (!fc.disabled) setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); play(zone.current, { scale: [0.98, 1] }, spring(0.4, 0.3)) }}
        className={cn('mb-1 flex cursor-pointer flex-col items-center gap-1 rounded-[var(--r-md)] border-[1.5px] border-dashed p-4 text-center text-[13px] text-[var(--fg2)] transition-colors disabled:cursor-not-allowed disabled:bg-[var(--muted)] disabled:text-[var(--fg3)]',
          over ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : fc.invalid ? 'border-[var(--bad)] bg-transparent' : 'border-[var(--line2)] bg-transparent hover:bg-[var(--muted)] disabled:hover:bg-[var(--muted)]')}>
        <Icon name="upload" size={20} className="text-[var(--fg3)]" />
        <span className="[@media(hover:none)]:hidden"><b className="font-medium text-[var(--fg)]">Drop files</b> or click to browse</span>
        <span className="hidden [@media(hover:none)]:inline"><b className="font-medium text-[var(--fg)]">{'Tap to choose files'}</b></span>
        <span className="text-xs text-[var(--fg3)]">{hint ?? 'Any type, up to 20 MB'}</span>
      </motion.button>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} name={fieldName} form={fp.form} disabled={fc.disabled} onChange={e => { add(e.target.files); e.target.value = '' }} />
      {skipped && <p role="status" className="m-0 mb-1 text-xs text-[var(--bad)]">{skipped}</p>}
      <AnimatePresence initial={false}>
        {files.map(f => <FormsFileRow key={f.id} f={f} upload={upload} onRemove={() => { fc.set(files.length - 1); setFiles(x => x.filter(y => y.id !== f.id)) }} />)}
      </AnimatePresence>
      {fc.inputs}
    </div>
  )
}
