import { useId, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react'
import { LayoutGroup, motion } from 'motion/react'
import { AvatarStack, Badge, DeltaBadge, Icon, ScrollEdges, StatusIcon, type StatusIconStatus, TOUCH, type Tone, cn, safeColor, spring, surface, useCoarsePointer, useControllable, useRefocus, useScrollEdges, SparkChart, plural, fmt } from './core'
import { Collapse, useToast } from './feedback'
import { useDragSort } from './layout'

/** Move an item (by id) inside a list of lists to `index` of list `to`. */
function kanbanMove<C extends { id: string }, I extends { id: string }>(cols: C[], get: (c: C) => I[], set: (c: C, items: I[]) => C, id: string, to: string, index: number) {
  let item: I | undefined
  const stripped = cols.map(c => { const items = get(c), i = items.findIndex(x => x.id === id); if (i < 0) return c; item = items[i]; return set(c, items.filter(x => x.id !== id)) })
  if (!item) return cols
  return stripped.map(c => c.id === to ? set(c, [...get(c).slice(0, index), item!, ...get(c).slice(index)]) : c)
}

export type KanbanCard = {
  id: string; title: string; tag?: { label: string; tone: Tone }
  priority?: 'High' | 'Med' | 'Low'; due?: string; assignees?: string[]; /** @deprecated use assignees */ assignee?: string
  /** two colours for a gradient cover */ cover?: [string, string]
  checklist?: { text: string; done: boolean }[]; comments?: number; attachments?: number
  /** what it's waiting on; shows a Blocked badge and a striped card */ blocked?: string
  /** linked pull request with its CI checks, e.g. { number: '#482', checks: [{ name: 'Build', status: 'ok' }] } */
  pr?: { number: string; checks: { name: string; status: KanbanCheckStatus }[] }
  /** a tracked number: label, value, % change (▲ / ▼ pill, green when the change is good) and an optional sparkline */
  metric?: { label: string; value: string; delta: number; trend?: number[]; /** a fall is good news (latency, errors) */ lowerIsBetter?: boolean }
}
export type KanbanCheckStatus = 'ok' | 'bad' | 'running'
export type KanbanColumn = { id: string; title: string; color?: string; /** WIP limit */ limit?: number; cards: KanbanCard[] }

const KB_PRI: Record<string, string> = { High: 'var(--bad)', Med: 'var(--warn)', Low: 'var(--fg3)' }
const KB_CHECK: Record<KanbanCheckStatus, [StatusIconStatus, string]> = { ok: ['done', 'passed'], bad: ['failed', 'failed'], running: ['active', 'running'] }

/** Metric panel inside a card: value, change pill and a sparkline that fills the rest of the row. */
function KanbanMetric({ m }: { m: NonNullable<KanbanCard['metric']> }) {
  const good = m.lowerIsBetter ? m.delta < 0 : m.delta >= 0, color = good ? 'var(--ok)' : 'var(--bad)'
  const t = m.trend?.filter(Number.isFinite) ?? []
  return (
    <div className={cn(surface.md, '-mt-0.5 mb-2 grid grid-cols-[auto_1fr] items-center gap-2.5 p-2')}>
      <div className="min-w-0">
        <span className="block text-[11px] text-[var(--fg3)]">{m.label}</span>
        <span className="flex items-center gap-1.5">
          <b className="text-sm font-semibold tracking-[-.01em] tabular-nums">{m.value}</b>
          <DeltaBadge value={m.delta} lowerIsBetter={m.lowerIsBetter} digits={Number.isInteger(m.delta) ? 0 : 1} className="font-semibold" />
        </span>
      </div>
      {t.length > 1 && <SparkChart data={t} height={26} color={color} />}
    </div>
  )
}

/**
 * Board with rich cards. Drag cards between columns (drops at the pointer's position) and drag a column
 * header to reorder columns. Keys: each card has a drag-handle button (⠿); arrows move focus between cards, Alt + arrows
 * move the card, Alt + Shift + ← / → move its column. Columns with a `limit` turn red past it. "+ Add card" opens an
 * inline textarea (Enter adds). On touch, press and hold a card to pick it up.
 */
export function Kanban({ value, defaultValue = [], onChange, doneColumn, newCard, className }:
  { value?: KanbanColumn[]; defaultValue?: KanbanColumn[]; onChange?: (c: KanbanColumn[]) => void; /** column id counted as done (default: last) */ doneColumn?: string
    newCard?: (title: string) => Omit<KanbanCard, 'id' | 'title'>; className?: string }) {
  const [cols, setCols] = useControllable(value, defaultValue, onChange)
  const ref = useRef(cols); ref.current = cols
  const update = (fn: (c: KanbanColumn[]) => KanbanColumn[]) => { const next = fn(ref.current); if (next !== ref.current) { ref.current = next; setCols(next) } }
  const toast = useToast()
  const rootRef = useRef<HTMLDivElement>(null)
  const refocus = useRefocus(rootRef)
  const hint = useId()
  const [adding, setAdding] = useState<string | null>(null)
  const [openChk, setOpenChk] = useState<string[]>([])
  const moveCard = (id: string, to: string, index: number) =>
    update(cs => kanbanMove(cs, c => c.cards, (c, cards) => ({ ...c, cards }), id, to, index))
  const moveCol = (id: string, index: number) => update(cs => { const c = cs.find(x => x.id === id)!; const rest = cs.filter(x => x.id !== id); return [...rest.slice(0, index), c, ...rest.slice(index)] })
  const checkLimit = (colId: string) => {
    const c = ref.current.find(x => x.id === colId)
    if (c?.limit && c.cards.length > c.limit) toast({ title: 'WIP limit exceeded', description: `${c.title} has more than ${plural(c.limit, 'card')}`, tone: 'bad' })
  }
  const cards = useDragSort({ onMove: moveCard, onDrop: (_, list) => list && checkLimit(list) })
  const columns = useDragSort({ axis: 'x', onMove: (id, _, i) => moveCol(id, i) })
  const done = doneColumn ?? cols[cols.length - 1]?.id
  const total = cols.reduce((n, c) => n + c.cards.length, 0)
  const cardSel = (id: string) => `[data-kb-card="${CSS.escape(id)}"]`
  const focusCard = (id?: string) => { if (id) rootRef.current?.querySelector<HTMLElement>(cardSel(id))?.focus() }
  const [board, edges] = useScrollEdges<HTMLDivElement>()
  const anyDrag = !!(cards.dragging || columns.dragging)

  const onCardKey = (e: RKeyboardEvent, ci: number, ri: number, card: KanbanCard) => {
    const col = cols[ci], arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    if (e.target !== e.currentTarget || !arrows.includes(e.key)) return
    e.preventDefault()
    const key = e.key
    const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0, dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0
    if (e.altKey && e.shiftKey) { if (dx && cols[ci + dx]) { moveCol(col.id, ci + dx); refocus(cardSel(card.id)) } return }
    if (e.altKey) {
      if (dx && cols[ci + dx]) { moveCard(card.id, cols[ci + dx].id, Math.min(ri, cols[ci + dx].cards.length)); checkLimit(cols[ci + dx].id) }
      if (dy && ri + dy >= 0 && ri + dy < col.cards.length) moveCard(card.id, col.id, ri + dy)
      refocus(cardSel(card.id)); return
    }
    if (dy) focusCard(col.cards[ri + dy]?.id)
    if (dx) { const n = cols[ci + dx]; if (n?.cards.length) focusCard(n.cards[Math.min(ri, n.cards.length - 1)].id) }
  }
  const toggleItem = (cardId: string, i: number) => update(cs => cs.map(c => ({
    ...c, cards: c.cards.map(k => {
      if (k.id !== cardId || !k.checklist) return k
      const checklist = k.checklist.map((x, j) => j === i ? { ...x, done: !x.done } : x)
      if (checklist.every(x => x.done)) toast({ title: 'Checklist complete', description: k.title })
      return { ...k, checklist }
    }),
  })))
  const add = (colId: string, title: string) => {
    const id = `kb${Date.now().toString(36)}`
    update(cs => cs.map(c => c.id === colId ? { ...c, cards: [...c.cards, { ...(newCard?.(title) ?? { title }), id, title }] } : c))
    checkLimit(colId)
  }

  return (
    <LayoutGroup>
      <div ref={rootRef} className={cn('flex flex-col gap-2', className)}>
        <span id={hint} hidden>{'Arrow keys move between cards. Alt and arrow keys move this card; Alt, Shift and left or right move its column.'}</span>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-[var(--fg3)]">
          <span className="hidden [@media(pointer:coarse)]:inline">{'Press and hold a card to move it'}</span>
          <span className="ms-auto" aria-live="polite">{`${plural(total, 'card')} · ${cols.find(c => c.id === done)?.cards.length ?? 0} done`}</span>
        </div>
        <div className="relative">
        <div ref={board} {...columns.listProps('board')}
          className={cn('grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain pb-1', !anyDrag && 'snap-x snap-mandatory')}>
          {cols.map((col, ci) => {
            const over = !!col.limit && col.cards.length > col.limit, isDragged = columns.dragging === col.id
            return (
              <motion.div key={col.id} layout="position" transition={spring(0.18, 0.4)} {...columns.itemProps(col.id)} data-sort-area=""
                role="group" aria-label={`${col.title}, ${plural(col.cards.length, 'card')}`}
                className={cn('flex min-h-[320px] snap-start flex-col gap-2 rounded-[var(--r-lg)] p-2.5 transition-[box-shadow,background-color]',
                  isDragged ? 'border-[1.5px] border-dashed border-[var(--line2)] bg-transparent [&>*]:opacity-0' : 'bg-[color-mix(in_srgb,var(--muted)_60%,var(--card))]',
                  cards.over === col.id && cards.dragging && 'shadow-[inset_0_0_0_1.5px_var(--line2)]', over && 'shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--bad)_50%,transparent)]')}>
                <div {...columns.handleProps(col.id)} title={'Drag to reorder columns'}
                  className={cn('group flex cursor-grab items-center gap-2 rounded-[var(--r-md)] px-1 pt-0.5 pb-1 text-[13px] font-semibold select-none [-webkit-touch-callout:none] active:cursor-grabbing', TOUCH.tap36)}>
                  <span className="-ms-0.5 text-[var(--fg3)] opacity-35 transition-opacity group-hover:opacity-100"><Icon name="grip" size={12} strokeWidth={3.2} /></span>
                  <i className="h-2 w-2 rounded-full" style={{ background: safeColor(col.color, 'var(--fg3)') }} />{col.title}
                  <motion.span key={col.cards.length} initial={{ scale: 1.3 }} animate={{ scale: 1 }} transition={spring(0.5, 0.3)}
                    className="inline-flex"><Badge size="sm" tone={over ? 'bad' : 'neutral'} className={cn('tabular-nums', !over && '!bg-[var(--card)] !text-[var(--fg3)]')}>{col.cards.length}</Badge></motion.span>
                  {col.limit && <span className="ms-auto text-[11px] font-normal text-[var(--fg3)]">{`Limit ${col.limit}`}</span>}
                </div>
                <div {...cards.listProps(col.id)} role="list" aria-label={`${col.title} cards`} className="flex min-h-10 flex-1 flex-col gap-2">
                  {col.cards.map((card, ri) => (
                    <KanbanCardView key={card.id} card={card} dragging={cards.dragging === card.id} sortProps={{ ...cards.itemProps(card.id), ...cards.handleProps(card.id) }}
                      label={`Move ${card.title}, ${col.title}, ${ri + 1} of ${col.cards.length}`} hint={hint} open={openChk.includes(card.id)}
                      onToggleOpen={() => setOpenChk(o => o.includes(card.id) ? o.filter(x => x !== card.id) : [...o, card.id])}
                      onToggleItem={i => toggleItem(card.id, i)} onKeyDown={e => onCardKey(e, ci, ri, card)} />
                  ))}
                </div>
                {adding === col.id
                  ? <textarea autoFocus rows={2} placeholder={'Card title, Enter to add'} aria-label={`New card in ${col.title}`}
                    onKeyDown={e => {
                      if (e.key === 'Escape') setAdding(null)
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); const v = e.currentTarget.value.trim(); if (!v) return setAdding(null); add(col.id, v); e.currentTarget.value = '' }
                    }} onBlur={() => setTimeout(() => setAdding(a => a === col.id ? null : a), 120)}
                    className={cn('w-full resize-none rounded-[var(--r-md)] border border-[var(--line2)] bg-[var(--card)] px-2.5 py-2 text-[13px] outline-none placeholder:text-[var(--fg3)] focus:border-[var(--fg3)]', TOUCH.input)} />
                  : <button onClick={() => setAdding(col.id)} className={cn('cursor-pointer rounded-[var(--r-md)] border-0 bg-transparent px-1.5 py-1.5 text-start text-xs font-medium text-[var(--fg3)] hover:bg-[var(--card)] hover:text-[var(--fg)] [@media(pointer:coarse)]:text-[13px]', TOUCH.row)}>{'+ Add card'}</button>}
              </motion.div>
            )
          })}
        </div>
        <ScrollEdges {...edges} hint={'More columns'} at="top" className="!bottom-1" />

        </div>
      </div>
    </LayoutGroup>
  )
}

/** One card: a list item (not a button, so its checklist controls stay real controls) with a ⠿ drag-handle button for keyboard moves. */
function KanbanCardView({ card, dragging, sortProps, label, hint, open, onToggleOpen, onToggleItem, onKeyDown }:
  { card: KanbanCard; dragging: boolean; sortProps: Record<string, unknown>; label: string; hint: string; open: boolean; onToggleOpen: () => void; onToggleItem: (i: number) => void; onKeyDown: (e: RKeyboardEvent) => void }) {
  const done = card.checklist?.filter(x => x.done).length ?? 0, total = card.checklist?.length ?? 0
  const people = card.assignees ?? (card.assignee ? [card.assignee] : [])
  const coarse = useCoarsePointer()


  return (
    <motion.div layout layoutId={`kb-${card.id}`} transition={spring(0.18, 0.4)} {...sortProps} role="listitem"
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      style={card.blocked && !dragging ? { background: 'repeating-linear-gradient(135deg,var(--card) 0 10px,color-mix(in srgb,var(--muted) 70%,var(--card)) 10px 20px)' } : undefined}
      className={cn('relative cursor-grab rounded-[var(--r-md)] border px-3 py-2.5 select-none [-webkit-touch-callout:none] active:cursor-grabbing has-[[data-kb-card]:focus-visible]:shadow-[0_0_0_2px_var(--accent)]',
        dragging ? 'border-dashed border-[var(--line2)] bg-transparent [&>*]:invisible' : 'border-[var(--line)] bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,.04)] hover:border-[var(--line2)]')}>
      {card.cover && <div className="-mx-1 -mt-1 mb-2 h-16 rounded-[calc(var(--r-md)-3px)] opacity-90" style={{ background: `linear-gradient(135deg,${card.cover[0]},${card.cover[1]})` }} />}
      <div className="flex flex-wrap items-center gap-1.5">
        {card.tag && <Badge tone={card.tag.tone}>{card.tag.label}</Badge>}
        {card.blocked && <Badge tone="bad"><Icon name="lock" size={10} />{'Blocked'}</Badge>}
        <button data-kb-card={card.id} aria-label={label} aria-describedby={hint} aria-roledescription={'drag handle'} onKeyDown={onKeyDown}
          className="ui-hit [--hit:40px] -my-1 -me-1.5 ms-auto grid h-6 w-6 cursor-grab place-items-center rounded-[var(--r-sm)] border-0 bg-transparent p-0 text-[var(--fg3)] opacity-40 outline-none hover:bg-[var(--muted)] hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing">
          <Icon name="grip" size={12} strokeWidth={3.2} />
        </button>
      </div>
      <div className="mt-1.5 mb-2 text-[13px] leading-snug font-medium">{card.title}</div>
      {card.blocked && <div className="-mt-1 mb-2 text-xs text-[var(--fg2)]">Waiting on <b className="font-medium text-[var(--fg)]">{card.blocked}</b></div>}
      {card.metric && <KanbanMetric m={card.metric} />}
      {card.pr && (
        <div className={cn(surface.md, '-mt-0.5 mb-2 flex flex-wrap items-center gap-1.5 bg-transparent px-2 py-1.5 text-[11px] text-[var(--fg2)]')}>
          <Icon name="pullRequest" size={11} />
          <b className="font-[family-name:var(--mono)] text-[11px] font-semibold text-[var(--fg)]">{card.pr.number}</b>
          <span className="flex-1" />
          {card.pr.checks.map(c => (
            <span key={c.name} className="inline-flex items-center gap-1" title={`${c.name}: ${KB_CHECK[c.status][1]}`}>
              <StatusIcon status={KB_CHECK[c.status][0]} size={12} tone="ok" className={c.status === 'running' ? '!border-[var(--warn)] !border-e-transparent' : undefined} />
              {c.name}<span className="sr-only"> {KB_CHECK[c.status][1]}</span>
            </span>
          ))}
        </div>
      )}
      {card.checklist && (
        <>
          {/* the name reads "Checklist 2/4 done": it contains the visible "2/4" */}
          <button onClick={onToggleOpen} aria-expanded={open} data-no-drag aria-label={`Checklist ${done}/${total} done`}
            className={cn('-mt-1 mb-1.5 flex min-h-6 w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-[11px] font-medium tabular-nums text-[var(--fg2)]', TOUCH.tap)}>
            <span aria-hidden className="h-[5px] flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
              <motion.span className={cn('block h-full rounded-full', total && done === total ? 'bg-[var(--ok)]' : 'bg-[var(--accent)]')} initial={false} animate={{ scaleX: total ? done / total : 0 }} style={{ originX: 0 }} transition={spring(0.2, 0.4)} />
            </span><span aria-hidden>{fmt.number(done)}/{fmt.number(total)}</span>
          </button>
          <Collapse open={open}>
            <div className="pb-1.5">
              {card.checklist.map((x, i) => (
                <label key={i} data-no-drag className={cn('flex cursor-pointer items-center gap-2 py-1 text-xs [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:text-[13px]')}>
                  <input type="checkbox" checked={x.done} onChange={() => onToggleItem(i)} className="m-0 accent-[var(--primary)] [@media(pointer:coarse)]:h-[18px] [@media(pointer:coarse)]:w-[18px]" />
                  <span className={cn(x.done && 'text-[var(--fg3)] line-through')}>{x.text}</span>
                </label>
              ))}
            </div>
          </Collapse>
        </>
      )}
      {/* wraps (avatars drop to their own line) rather than spilling out of a narrow column */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] whitespace-nowrap text-[var(--fg3)]">
        {card.priority && <span role="img" aria-label={String(card.priority === 'High' ? 'High priority' : card.priority === 'Med' ? 'Medium priority' : card.priority === 'Low' ? 'Low priority' : `${card.priority} priority`)} title={String(card.priority === 'High' ? 'High priority' : card.priority === 'Med' ? 'Medium priority' : card.priority === 'Low' ? 'Low priority' : `${card.priority} priority`)} className="h-[7px] w-[7px] flex-none rounded-[var(--r-sm)]" style={{ background: KB_PRI[card.priority] }} />}
        {card.due && <span className="inline-flex items-center gap-1"><Icon name="calendar" size={11} />{card.due}</span>}
        {!!card.comments && <span className="inline-flex items-center gap-1" title={plural(card.comments, 'comment')}><Icon name="message" size={11} />{card.comments}</span>}
        {!!card.attachments && <span className="inline-flex items-center gap-1" title={plural(card.attachments, 'attachment')}><Icon name="paperclip" size={11} />{card.attachments}</span>}
        {people.length > 0 && <AvatarStack names={people} max={3} size={coarse ? 26 : 22} spread={false} className="ms-auto !items-end [&_span[title]]:[@media(pointer:coarse)]:!text-[11px]" />}
      </div>
    </motion.div>
  )
}
