import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type Ref } from 'react'
import { type FormControlProps, useFormControl, Button, Icon, IconButton, cn, spring, plural, fmt, composeRefs } from './core'
import { PresenceList, play } from './motion'
import { Progress } from './feedback'

/** Uploads one file: report 0–100 through `onProgress`, stop when `signal` aborts (the row was removed), reject on failure. */
export type FileUploader = (file: File, onProgress: (pct: number) => void, ctx: { signal: AbortSignal }) => Promise<void>
/** Files a drop or pick turned away, and why: not an accepted type, over `maxSize`, or no room left. */
export type FileRejection = { reason: 'type' | 'size' | 'count'; files: File[] }

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

/** Split dropped or picked files into the ones to keep (matching `accept`, at most `maxSize` bytes, at most `room` of them) and the rejected ones by reason. */
export function filterFiles(files: readonly File[], { accept, maxSize, room = Infinity }: { accept?: string; maxSize?: number; room?: number }) {
  const ok: File[] = [], by: Record<FileRejection['reason'], File[]> = { type: [], size: [], count: [] }
  for (const f of files) {
    if (!fileAccepts(f, accept)) by.type.push(f)
    else if (maxSize !== undefined && f.size > maxSize) by.size.push(f)
    else if (ok.length < room) ok.push(f)
    else by.count.push(f)
  }
  const rejected = (['type', 'size', 'count'] as const).filter(r => by[r].length).map((reason): FileRejection => ({ reason, files: by[reason] }))
  return { ok, rejected }
}

/** Drag-over state and handlers for a file drop zone; counts enter/leave so crossing the zone's children doesn't flicker it. */
export function useFileDrop(onDrop: (files: FileList) => void, enabled = true) {
  const [over, setOver] = useState(false), depth = useRef(0)
  const props = {
    onDragEnter: (e: DragEvent) => { e.preventDefault(); if (!enabled) return; depth.current++; setOver(true) },
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) },
    onDrop: (e: DragEvent) => { e.preventDefault(); depth.current = 0; setOver(false); if (enabled) onDrop(e.dataTransfer.files) },
  }
  return { over, props }
}

type FormsFileStatus = 'ready' | 'uploading' | 'done' | 'failed'
/** A row: picked files carry `file`; `defaultFiles` don't (they already exist). `attempt` restarts the upload (Retry). */
type FormsFile = { id: number; name: string; size: number; file?: File; status: FormsFileStatus; attempt: number }
let formsFileSeq = 0
const formsDefaultRows = (list: { name: string; size: number }[]): FormsFile[] => list.map(f => ({ name: f.name, size: f.size, id: ++formsFileSeq, status: 'done', attempt: 0 }))

function FormsFileRow({ f, present, upload, onStatus, onRetry, onRemove, ref, ...presence }: { f: FormsFile; /** false once removed, while the row still animates out */ present: boolean
  upload?: FileUploader; onStatus: (s: FormsFileStatus) => void; onRetry: () => void; onRemove: () => void; ref?: Ref<HTMLDivElement> }) {
  const [pct, setPct] = useState(0)
  const fns = useRef({ upload, onStatus }) // latest without restarting: inline props change identity every render
  useLayoutEffect(() => { fns.current = { upload, onStatus } })
  useEffect(() => {
    const run = fns.current.upload
    if (f.status !== 'uploading' || !run || !f.file || !present) return
    const ac = new AbortController()
    setPct(0)
    run(f.file, p => { if (!ac.signal.aborted) setPct(Math.min(99, p)) }, { signal: ac.signal })
      .then(() => { if (!ac.signal.aborted) fns.current.onStatus('done') }, () => { if (!ac.signal.aborted) fns.current.onStatus('failed') })
    return () => ac.abort()
  }, [f.id, f.attempt, present]) // eslint-disable-line react-hooks/exhaustive-deps
  const uploaded = !!f.file && f.status === 'done', failed = f.status === 'failed'
  const status = f.status === 'ready' ? 'Ready' : f.status === 'uploading' ? `Uploading ${fmt.percent(Math.round(pct) / 100)}` : failed ? 'Upload failed' : uploaded ? 'Uploaded' : ''
  const size = f.size ? fmt.bytes(f.size) : ''
  return (
    // leaving: slides out, then the row closes
    <div ref={ref} {...presence} className="ui-grow [--ui-xo:20px] [&[data-ui-exit]]:[animation:ui-out_.15s_ease-in_forwards,ui-shrink_.18s_ease-out_.12s_forwards]">
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] py-2 text-[13px]">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[var(--r-md)] bg-[var(--muted)] font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg2)] uppercase">{(f.name.split('.').pop() || 'file').slice(0, 4)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{f.name}</span>
          <span className={cn('block text-xs transition-colors', uploaded ? 'text-[var(--ok)]' : failed ? 'text-[var(--bad)]' : 'text-[var(--fg3)]')} aria-live="polite">{[size, status].filter(Boolean).join(' · ')}</span>
          {upload && f.file && <Progress value={f.status === 'uploading' ? pct : 100} tone={uploaded ? 'ok' : failed ? 'bad' : 'primary'} label={`Upload of ${f.name}`} className="mt-1 !h-1" />}
        </span>
        {failed && <Button size="xs" variant="ghost" onClick={onRetry}>Retry</Button>}
        <IconButton icon="x" label={`Remove ${f.name}`} onClick={onRemove} />
      </div>
    </div>
  )
}

/** Why some dropped files weren't added, in a line. */
function formsSkipText({ reason, files }: FileRejection, accept?: string, maxSize?: number) {
  const one = files.length === 1 ? `“${files[0].name}”` : null
  if (reason === 'type') return `${one ? `${one} isn’t` : `${plural(files.length, 'file')} aren’t`} an accepted type${accept ? ` (${accept})` : ''}`
  if (reason === 'size') return `${one ? `${one} is` : `${plural(files.length, 'file')} are`} over ${fmt.bytes(maxSize ?? 0)}`
  return `${one ? `${one} wasn’t` : `${plural(files.length, 'file')} weren’t`} added: only one file is allowed`
}

/**
 * Drop zone + file list; removed rows slide out and collapse. Without `upload` a picked file shows "Ready" (it goes with
 * the form); with `upload(file, onProgress, { signal })` each file uploads at once with a progress bar, "Uploaded" once the
 * promise resolves, and "Upload failed" with Retry when it rejects (removing a row aborts its upload through `signal`).
 * `defaultFiles` seed the list as files that already exist. Files are filtered by `accept` and `maxSize` (bytes); without
 * `multiple` a new file replaces the old one. Skipped files go to `onReject(files, reason)` and a note under the zone.
 * `accept` only checks the name and reported type: validate type, size and content on the server. `hint` replaces the
 * line built from `accept` and `maxSize`.
 * Form-native: with `name`, the files in the list (picked or dropped; not failed uploads) are submitted as a native file
 * field (multipart FormData / server actions; `defaultFiles` have no content and aren't sent); `required` (at least one
 * file that didn't fail), `disabled`, `invalid`, `onBlur`, `form`, and `ref` on the drop zone. Reset restores `defaultFiles`.
 */
export function FileUpload({ onFiles, onReject, accept, multiple = true, maxSize, hint, defaultFiles = [], upload, className, name, ref, ...fp }: Omit<FormControlProps, 'readOnly'> &
  { onFiles?: (f: File[]) => void; /** files dropped or picked that weren't added, and why */ onReject?: (files: File[], reason: FileRejection['reason']) => void
    accept?: string; multiple?: boolean; /** largest file in bytes */ maxSize?: number; hint?: string; defaultFiles?: { name: string; size: number }[]
    /** upload one file for real; a rejected promise marks the row failed */ upload?: FileUploader; className?: string; ref?: Ref<HTMLButtonElement> }) {
  const [files, setFiles] = useState<FormsFile[]>(() => formsDefaultRows(defaultFiles))
  const [skipped, setSkipped] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null), zone = useRef<HTMLButtonElement>(null)
  const kept = files.filter(f => f.status !== 'failed')
  const fc = useFormControl<number>({ ...fp, value: kept.length, defaultValue: defaultFiles.length, serialize: () => null, filled: n => n > 0, focus: () => zone.current?.focus(),
    onReset: () => { setFiles(formsDefaultRows(defaultFiles)); setSkipped(null) } })
  const fieldName = name ?? fc.field?.name
  useEffect(() => { // the native file input carries the list, so the form submits the files
    const el = input.current
    if (!el || !fieldName || typeof DataTransfer === 'undefined') return
    try { const dt = new DataTransfer(); kept.forEach(f => { if (f.file) dt.items.add(f.file) }); el.files = dt.files } catch { /* very old browsers: nothing to submit */ }
  }, [files, fieldName]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = (list: FileList | null) => {
    if (!list?.length || fc.disabled) return
    const { ok, rejected } = filterFiles([...list], { accept, maxSize, room: multiple ? Infinity : 1 })
    setSkipped(rejected.length ? rejected.map(r => formsSkipText(r, accept, maxSize)).join('. ') : null)
    rejected.forEach(r => onReject?.(r.files, r.reason))
    if (!ok.length) return
    const rows = ok.map((file): FormsFile => ({ id: ++formsFileSeq, name: file.name, size: file.size, file, status: upload ? 'uploading' : 'ready', attempt: 0 })).reverse()
    setFiles(x => (multiple ? [...rows, ...x] : rows)); fc.markEdited(); onFiles?.(ok)
  }
  const patch = (id: number, p: Partial<FormsFile>) => setFiles(x => x.map(f => (f.id === id ? { ...f, ...p } : f)))
  const drop = useFileDrop(l => { add(l); play(zone.current, { scale: [0.98, 1] }, spring(0.4, 0.3)) }, !fc.disabled)
  const over = drop.over
  return (
    <div className={cn('relative flex flex-col', className)} onBlur={fc.onBlur}>
      <button ref={composeRefs(zone, ref)} type="button" {...fc.control} disabled={fc.disabled} onClick={() => input.current?.click()}
        {...drop.props}
        className={cn('mb-1 flex cursor-pointer flex-col items-center gap-1 rounded-[var(--r-md)] border-[1.5px] border-dashed p-4 text-center text-[13px] text-[var(--fg2)] transition-[color,background-color,border-color,scale] duration-300 ease-[var(--ui-spring)] disabled:cursor-not-allowed disabled:bg-[var(--muted)] disabled:text-[var(--fg3)]',
          over ? 'scale-[1.02] border-[var(--accent)] bg-[var(--accent-soft)]' : fc.invalid ? 'border-[var(--bad)] bg-transparent' : 'border-[var(--line2)] bg-transparent hover:bg-[var(--muted)] disabled:hover:bg-[var(--muted)]')}>
        <Icon name="upload" size={20} className="text-[var(--fg3)]" />
        <span className="[@media(hover:none)]:hidden"><b className="font-medium text-[var(--fg)]">{multiple ? 'Drop files' : 'Drop a file'}</b> or click to browse</span>
        <span className="hidden [@media(hover:none)]:inline"><b className="font-medium text-[var(--fg)]">{multiple ? 'Choose files' : 'Choose a file'}</b></span>
        <span className="text-xs text-[var(--fg3)]">{hint ?? `${accept ? `Accepts ${accept.split(',').map(s => s.trim()).filter(Boolean).join(', ')}` : 'Any file type'}${maxSize ? `, up to ${fmt.bytes(maxSize)}` : ''}`}</span>
      </button>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} name={fieldName} form={fp.form} disabled={fc.disabled} onChange={e => { add(e.target.files); e.target.value = '' }} />
      {skipped && <p role="status" className="m-0 mb-1 text-xs text-[var(--bad)]">{skipped}</p>}
      <PresenceList items={files} keyOf={f => f.id}>
        {(f, { exiting }) => (
          <FormsFileRow f={f} present={!exiting} upload={upload} onStatus={status => patch(f.id, { status })} onRetry={() => { patch(f.id, { status: 'uploading', attempt: f.attempt + 1 }); fc.markEdited() }}
            onRemove={() => { setFiles(x => x.filter(y => y.id !== f.id)); fc.markEdited() }} />
        )}
      </PresenceList>
      {fc.inputs}
    </div>
  )
}
