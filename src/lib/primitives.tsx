/** Primitives: surface classes, Button, IconButton, Spinner, Badge, StatusIcon, Chip, Kbd, Card, Avatar, AnimatedNumber, ScrollEdges, sparklines. Part of @lyndon/ui/core. */
import { type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactNode, cloneElement as slotClone, type ReactElement as SlotElement, type Ref as SlotRef, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { cn, maxOf, minOf, spring, variants } from './helpers'
import { useWidth } from './hooks'
import { Icon, type IconName, isIconName } from './icons'
import { dirX, numberFormat, useLocale } from './locale'
import { safeMediaUrl } from './safe'
import { Slot, slotOnlyChild } from './slot'

// rtl-lint-ignore: the fades are physical on purpose (useScrollEdges reports hidden content per physical side)
const SCROLL_FADE = {
  card: ['from-[var(--card)]', 'bg-gradient-to-r', 'bg-gradient-to-l'], // rtl-lint-ignore
  bg: ['from-[var(--bg)]', 'bg-gradient-to-r', 'bg-gradient-to-l'], // rtl-lint-ignore
} as const

/**
 * Edge fades for a horizontal scroller, plus (on touch screens, until the first scroll) a small "swipe for
 * more" pill on the end side (right in LTR, left in RTL). Render it as a sibling of the scroller inside a `relative`
 * wrapper; feed it `useScrollEdges`. `hint` defaults to the locale's "Swipe for more"; pass `null` to hide it.
 */
export function ScrollEdges({ left, right, touched, hint, fade = 'card', at = 'bottom', className }:
  { left: boolean; right: boolean; touched?: boolean; hint?: ReactNode; fade?: keyof typeof SCROLL_FADE; /** where the hint pill sits */ at?: 'top' | 'bottom'; className?: string }) {
  const { t, dir } = useLocale()
  const [from, toR, toL] = SCROLL_FADE[fade]
  const more = dir === 'rtl' ? left : right, label = hint === undefined ? t('field.swipeForMore') : hint
  return (
    <>
      {/* rtl-lint-ignore: physical sides, matching useScrollEdges' left/right */}
      <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 left-0 z-[6] w-5 to-transparent transition-opacity duration-200', from, toR, left ? 'opacity-100' : 'opacity-0', className)} />
      {/* rtl-lint-ignore */}
      <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 right-0 z-[6] w-5 to-transparent transition-opacity duration-200', from, toL, right ? 'opacity-100' : 'opacity-0', className)} />
      <AnimatePresence>
        {more && !touched && label && (
          <motion.span key="hint" aria-hidden initial={{ opacity: 0, x: dirX(6, dir) }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className={cn('pointer-events-none absolute end-2 z-[7] hidden items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--fg)_86%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--card)] shadow-[var(--shadow)] [@media(pointer:coarse)]:flex', at === 'top' ? 'top-2' : 'bottom-2')}>
            {label}<Icon name="chevronRight" size={12} strokeWidth={2.6} className="ui-flip" />
          </motion.span>
        )}
      </AnimatePresence>
    </>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * 4. PRIMITIVES
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Surface class strings: `card` (large radius, bordered), `md` (medium-radius tile), `muted` (tinted inset), `floating`
 * (popovers, menus, toasts), `dashed` (drop zones, empty slots). Add padding yourself.
 */
export const surface = {
  card: 'rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)]',
  md: 'rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)]',
  muted: 'rounded-[var(--r-md)] bg-[var(--muted)]',
  floating: 'rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow)]',
  dashed: 'rounded-[var(--r-md)] border-[1.5px] border-dashed border-[var(--line2)]',
} as const

/** Shared surface for every floating panel (same as surface.floating). */
export const floatingSurface = 'rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow)]'

/** Row look shared by menus, listboxes and the palette. Rows are at least 40px tall on touch screens. */
export const menuItemClass = 'flex w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--r-md)] border-0 bg-transparent px-2 py-2 text-start text-[13px] [@media(pointer:coarse)]:min-h-10 ' +
  'outline-none hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] data-[active=true]:bg-[var(--muted)]'

/**
 * The shared hover for fields and field triggers (Select, pickers, Combobox, MultiSelect, Phone, Currency…): the border
 * darkens to --line2. Hover-capable pointers only; focus and invalid borders still win. Rows and list items use
 * `rowHoverClass` (muted background) instead.
 */
export const fieldHoverClass = 'hover:border-[var(--line2)]'

/** Row hover for accordions, list rows and menu-like triggers: a muted background (hover-capable pointers only). */
export const rowHoverClass = 'hover:bg-[var(--muted)]'

/** Shared field look: every text-like control uses this (with the shared hover border). */
export const inputClass =
  'h-9 w-full rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)] px-3 text-[13px] outline-none transition-[border-color,box-shadow] ' + fieldHoverClass + ' ' +
  'placeholder:text-[var(--fg3)] focus:border-[var(--fg3)] focus:shadow-[0_0_0_3px_var(--muted)] ' +
  'aria-[invalid=true]:border-[var(--bad)] aria-[invalid=true]:shadow-[0_0_0_3px_var(--bad-soft)] disabled:opacity-60'

/**
 * Touch-only sizing (desktop look unchanged): `tap` ≥32px, `tap36` ≥36px, `row` ≥40px rows, `hit` an invisible 36px hit
 * area around something small, `input` 16px text so iOS doesn't zoom on focus. `target` (every pointer): an invisible hit
 * area of at least 24×24px with a mouse and 36px on touch, for tiny buttons like a chip's ×.
 */
export const TOUCH = {
  tap: '[@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8',
  tap36: '[@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:min-w-9',
  row: '[@media(pointer:coarse)]:min-h-10',
  hit: 'ui-hit',
  target: 'ui-target',
  input: '[@media(pointer:coarse)]:text-base',
} as const

export const buttonVariants = variants(
  'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium rounded-[var(--r-md)] border overflow-hidden ' +
  'cursor-pointer select-none transition-[background,opacity,border-color] disabled:opacity-60 disabled:cursor-default',
  {
    variant: {
      default: 'bg-[var(--card)] border-[var(--line)] hover:bg-[var(--muted)]',
      // hovers never lower text contrast: primary gets a soft ring; accent/danger move away from their card-coloured text
      primary: 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_22%,transparent)]',
      accent: 'bg-[var(--accent)] text-[var(--card)] border-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--fg))]',
      ghost: 'bg-transparent border-transparent hover:bg-[var(--muted)]',
      danger: 'bg-[var(--bad)] text-[var(--card)] border-[var(--bad)] hover:bg-[color-mix(in_srgb,var(--bad)_88%,var(--fg))]',
      'outline-danger': 'bg-[var(--card)] text-[var(--bad)] border-[var(--line)] hover:bg-[var(--bad-soft)]',
    },
    // heights follow the control scale (--h-xs/sm/md/lg = 24/30/36/40). Coarse pointers (touch): xs and sm sizes grow to
    // a 32px hit area; desktop sizes are unchanged
    size: {
      xs: 'h-6 gap-1 px-2 text-[11px] [@media(pointer:coarse)]:h-8', sm: 'h-[30px] px-3 text-xs [@media(pointer:coarse)]:h-8', md: 'h-9 px-3 text-[13px]', lg: 'h-10 px-4 text-sm',
      icon: 'h-9 w-9 p-0', 'icon-sm': 'h-7 w-7 p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8',
      'icon-xs': 'h-6 w-6 p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8',
    },
  },
  { variant: 'default', size: 'md' },
)

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop'> & {
  variant?: 'default' | 'primary' | 'accent' | 'ghost' | 'danger' | 'outline-danger'
  /** xs 24px · sm 30px · md 36px (default) · lg 40px; icon 36², icon-sm 28², icon-xs 24² (xs/sm sizes are 32px on touch). */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'icon-xs'
  loading?: boolean
  ref?: React.Ref<HTMLButtonElement>
  /** render the single child (a link, a router `Link`) with the button's classes and props instead of a <button>; see Slot */
  asChild?: boolean
}

/**
 * Every button presses down slightly (scale .96), like the original page. `asChild` renders your element instead
 * (`<Button asChild><a href="/docs">Docs</a></Button>`): same look, and `disabled`/`loading` become aria-disabled plus a
 * blocked click (the spinner only shows on a real <button>).
 */
export function Button({ variant, size, loading, className, children, disabled, type = 'button', asChild, ...p }: ButtonProps) {
  if (asChild) {
    const off = disabled || loading
    return (
      <Slot {...(p as HTMLAttributes<HTMLElement>)} ref={p.ref as SlotRef<HTMLElement>} aria-disabled={off || undefined} aria-busy={loading || undefined} data-disabled={off ? '' : undefined}
        className={buttonVariants({ variant, size, className: cn('no-underline active:scale-[0.96] aria-disabled:pointer-events-none aria-disabled:opacity-60', className) })}
        onClick={off ? e => e.preventDefault() : p.onClick as HTMLAttributes<HTMLElement>['onClick']}>{children}</Slot>
    )
  }
  return (
    <motion.button type={type} whileTap={disabled || loading ? undefined : { scale: 0.96 }} transition={{ duration: 0.12 }}
      disabled={disabled || loading} className={buttonVariants({ variant, size, className })} {...p}>
      {loading && <Spinner />}
      {children}
    </motion.button>
  )
}

const ICON_BUTTON_TONE = {
  muted: 'text-[var(--fg3)] hover:text-[var(--fg)]',
  default: '',
  danger: 'text-[var(--fg3)] hover:text-[var(--bad)] hover:!bg-[var(--bad-soft)]',
  /** on photos and video: always light, whatever the theme */
  onDark: '!border-transparent !bg-transparent text-white/85 hover:!bg-white/15 hover:text-white',
} as const

/**
 * Square icon button (toolbars, dismiss, overflow). `icon` is an ICONS name or any node; `tone` sets the colour: muted grey
 * (default), default (inherit), danger (red on hover), onDark (light, for media overlays). Always give it a label.
 */
export function IconButton({ icon, label, className, size = 'icon-sm', variant = 'ghost', tone = 'muted', asChild, children, ...p }:
  Omit<ButtonProps, 'children'> & { icon: IconName | ReactNode; label: string; tone?: keyof typeof ICON_BUTTON_TONE
    /** with `asChild`: the element to render (e.g. `<a href="/settings" />`); the icon goes inside it */ children?: SlotElement }) {
  const glyph = isIconName(icon) ? <Icon name={icon} size={size === 'icon-xs' ? 13 : size === 'icon-sm' ? 15 : 16} /> : icon
  return (
    <Button aria-label={label} title={label} size={size} variant={variant} asChild={asChild}
      className={cn(ICON_BUTTON_TONE[tone], className)} {...p}>
      {asChild ? slotClone(slotOnlyChild(children), undefined, glyph) : glyph}
    </Button>
  )
}

/**
 * `animation-play-state` for an infinite CSS animation (spinners): paused while the element is off screen, so nothing
 * keeps repainting where nobody can see it. One shared IntersectionObserver per element via motion's useInView.
 * (Components outside core can use motion's `useViewport().visible` the same way.)
 */
function useSpinPause<T extends Element>() {
  const ref = useRef<T>(null)
  const visible = useInView(ref, { margin: '64px' })
  const play = visible ? 'running' : 'paused'
  // --ui-play reaches the ::after animations of .ui-shimmer and .ui-caret (play-state itself doesn't inherit)
  return { ref, style: { animationPlayState: play, '--ui-play': play } as CSSProperties }
}

const SPINNER_TONE = { current: 'border-current', accent: 'border-[var(--accent)]', ok: 'border-[var(--ok)]', warn: 'border-[var(--warn)]', bad: 'border-[var(--bad)]' } as const

/** Spinning ring (role=status, "Loading" in the provider's language). `tone` colours it; default is the text colour. */
export function Spinner({ size = 14, tone = 'current', label, className }: { size?: number; tone?: keyof typeof SPINNER_TONE; label?: string; className?: string }) {
  const pause = useSpinPause<HTMLSpanElement>() // stops spinning while off screen
  const { t } = useLocale()
  return <span ref={pause.ref} role="status" aria-label={label ?? t('status.loading')} style={{ width: size, height: size, ...pause.style }}
    className={cn('inline-block flex-none animate-spin rounded-full border-2 border-e-transparent', SPINNER_TONE[tone], className)} />
}

export const TONE_SOFT = {
  neutral: 'bg-[var(--muted)] text-[var(--fg2)]',
  // text is the tone nudged toward --fg so it clears 4.5:1 on its own tint in light and dark
  ok: 'bg-[var(--ok-soft)] text-[color-mix(in_srgb,var(--ok)_78%,var(--fg))]',
  warn: 'bg-[var(--warn-soft)] text-[color-mix(in_srgb,var(--warn)_78%,var(--fg))]',
  bad: 'bg-[var(--bad-soft)] text-[color-mix(in_srgb,var(--bad)_78%,var(--fg))]',
  accent: 'bg-[var(--accent-soft)] text-[color-mix(in_srgb,var(--accent)_78%,var(--fg))]',
} as const

export type Tone = keyof typeof TONE_SOFT

/** The two badge geometries every pill, tag and count on the page uses: sm 18px / 11px text, md 20px / 12px text. */
export const BADGE_SIZE = { sm: 'h-[18px] gap-1 px-1.5 text-[11px]', md: 'h-5 gap-1 px-2 text-xs' } as const

/**
 * Status pill, tag or count: the one badge primitive. `size` sm (18px, for counts, deltas and dense rows) or md (20px,
 * default). Pair colour with a dot or word: never colour alone.
 */
export function Badge({ tone = 'neutral', size = 'md', dot, className, children }: { tone?: Tone; size?: keyof typeof BADGE_SIZE; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex flex-none items-center rounded-full leading-none font-medium whitespace-nowrap', BADGE_SIZE[size], TONE_SOFT[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}{children}
    </span>
  )
}

/**
 * ▲/▼ change pill, green when the change is good and red when it is bad (`lowerIsBetter` flips that), e.g. "▲ 3.2%".
 * Pops when the direction changes; screen readers hear "better" or "worse". Renders nothing for NaN/Infinity.
 */
export function DeltaBadge({ value, lowerIsBetter, digits = 1, suffix = '%', title, className }:
  { value: number; lowerIsBetter?: boolean; digits?: number; suffix?: string; title?: string; className?: string }) {
  const { t, fmt } = useLocale()
  if (!Number.isFinite(value)) return null
  const good = lowerIsBetter ? value < 0 : value >= 0
  return (
    <motion.span key={`${value >= 0}${good}`} initial={{ scale: 0.85 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)}
      title={title ?? t('status.deltaTitle', { value: t(good ? 'status.betterWord' : 'status.worseWord') })}
      className={cn('ui-num inline-flex items-center rounded-full leading-none font-medium whitespace-nowrap', BADGE_SIZE.sm,
        good ? 'bg-[var(--ok-soft)] text-[color-mix(in_srgb,var(--ok)_72%,var(--fg))]' : 'bg-[var(--bad-soft)] text-[color-mix(in_srgb,var(--bad)_78%,var(--fg))]', className)}>
      {value >= 0 ? '▲' : '▼'} {fmt.number(Math.abs(value), { minimumFractionDigits: digits, maximumFractionDigits: digits })}{suffix}<span className="sr-only">{' ' + t(good ? 'status.better' : 'status.worse')}</span>
    </motion.span>
  )
}

/** The states StatusIcon draws. */
export type StatusIconStatus = 'done' | 'active' | 'pending' | 'failed'

/**
 * Round step/status marker for steppers, checks and task lists: done (filled tick, pops in), failed (filled ✕), active
 * (spinning ring, or the step `number` in a bold ring), pending (grey ring, with `number` if given). `tone="ok"` paints done
 * green. Decorative unless you pass `label`.
 */
export function StatusIcon({ status, size = 18, number, tone = 'primary', label, className }:
  { status: StatusIconStatus; size?: number; number?: number; tone?: 'primary' | 'ok'; label?: string; className?: string }) {
  const spin = status === 'active' && number === undefined
  const pause = useSpinPause<HTMLSpanElement>() // the active ring stops spinning while off screen
  return (
    <span ref={pause.ref} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.5)), ...(spin ? pause.style : null) }}
      className={cn('relative z-[1] grid flex-none place-items-center rounded-full border-[1.5px] font-semibold leading-none not-italic transition-colors',
        status === 'done' ? (tone === 'ok' ? 'border-[var(--ok)] bg-[var(--ok)] text-[var(--card)]' : 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]')
          : status === 'failed' ? 'border-[var(--bad)] bg-[var(--bad)] text-[var(--card)]'
            : spin ? 'animate-spin border-[var(--accent)] border-e-transparent bg-[var(--card)]'
              : status === 'active' ? 'border-[var(--fg)] bg-[var(--card)] text-[var(--fg)]' : 'border-[var(--line2)] bg-[var(--card)] text-[var(--fg3)]', className)}>
      <AnimatePresence initial={false}>
        {status === 'done' && <motion.span key="d" className="grid" initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={spring(0.5, 0.35)}><Icon name="check" size={Math.round(size * 0.55)} strokeWidth={3.5} /></motion.span>}
      </AnimatePresence>
      {status === 'failed' && <Icon name="x" size={Math.round(size * 0.55)} strokeWidth={3.5} />}
      {(status === 'pending' || status === 'active') && number !== undefined && number}
    </span>
  )
}

/**
 * Pill button for filters, toggles and suggestions. With `pressed` it is a toggle (aria-pressed, filled when on); without,
 * a plain suggestion chip. 30px tall, 36px on touch. Takes every button prop.
 */
export function Chip({ pressed, icon, className, children, type = 'button', ...p }: Omit<ButtonProps, 'variant' | 'size' | 'loading'> & { pressed?: boolean; icon?: IconName | ReactNode }) {
  return (
    <motion.button type={type} aria-pressed={pressed} whileTap={p.disabled ? undefined : { scale: 0.95 }} transition={{ duration: 0.12 }}
      className={cn('inline-flex h-[30px] flex-none cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50 [@media(pointer:coarse)]:h-9',
        pressed ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]' : 'border-[var(--line)] bg-[var(--card)] text-[var(--fg2)] hover:bg-[var(--muted)] hover:text-[var(--fg)]', className)} {...p}>
      {isIconName(icon) ? <Icon name={icon} size={13} /> : icon}{children}
    </motion.button>
  )
}

/** A key or shortcut ("⌘K", "Esc"). Always left to right, so "⌘K" doesn't turn into "K⌘" in RTL text. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd dir="ltr" className={cn('rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--muted)] px-1 font-[family-name:var(--mono)] text-[11px] text-[var(--fg2)]', className)}>{children}</kbd>
}

/** Surface for grouping content. */
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(surface.card, 'p-4', className)} {...p} />
}

export function Separator({ vertical, className }: { vertical?: boolean; className?: string }) {
  return <div role="separator" className={cn(vertical ? 'w-px self-stretch' : 'h-px w-full', 'bg-[var(--line)]', className)} />
}

/** Loading placeholder with a shimmer sweep (paused while off screen; off for reduced motion). */
export function Skeleton({ className }: { className?: string }) {
  const pause = useSpinPause<HTMLDivElement>()
  return <div ref={pause.ref} style={pause.style} className={cn('ui-shimmer rounded-[var(--r-md)] bg-[var(--muted)]', className)} />
}

const AV_COLORS = ['#DBEAFE:#1E40AF', '#FCE7F3:#9D174D', '#DCFCE7:#166534', '#FEF3C7:#92400E', '#EDE9FE:#5B21B6', '#E0F2FE:#075985']

export function Avatar({ name, src, size = 32, status, className }:
  { name: string; src?: string; size?: number; status?: 'online' | 'away' | 'offline'; className?: string }) {
  const initials = name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase(), img = safeMediaUrl(src)
  const [bg, fg] = AV_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length].split(':')
  return (
    <span className={cn('relative inline-grid flex-none place-items-center rounded-full border-2 border-[var(--card)] font-semibold', className)}
      style={{ width: size, height: size, fontSize: size >= 28 ? Math.max(11, size * 0.36) : size * 0.36, background: bg, color: fg }} title={name}>
      {img ? <img src={img} alt={name} className="h-full w-full rounded-full object-cover" /> : initials}
      {status && <span className={cn('absolute -end-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--card)]',
        status === 'online' ? 'bg-[var(--ok)]' : status === 'away' ? 'bg-[var(--warn)]' : 'bg-[var(--line2)]')} />}
    </span>
  )
}

/**
 * Overlapping avatars with a "+N" bubble that fan out on hover or keyboard focus (`spread={false}` keeps them still), and an
 * optional caption like "9 people editing" underneath. The group is one Tab stop that names everyone.
 */
export function AvatarStack({ names, max = 4, size = 32, caption, spread: canSpread = true, className }:
  { names: string[]; max?: number; size?: number; caption?: ReactNode; spread?: boolean; className?: string }) {
  const [spread, setSpread] = useState(false)
  const { t, fmt, dir } = useLocale()
  const shown = names.slice(0, max), extra = names.length - shown.length
  const fan = canSpread && spread
  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="flex outline-none" tabIndex={canSpread ? 0 : undefined} role="group" aria-label={t('people.groupLabel', { count: names.length, names: fmt.list(names) })}
        onPointerEnter={e => e.pointerType === 'mouse' && setSpread(true)} onPointerLeave={e => e.pointerType === 'mouse' && setSpread(false)}
        onFocus={() => setSpread(true)} onBlur={() => setSpread(false)}>
        {[...shown, ...(extra > 0 ? [null] : [])].map((n, i) => (
          <motion.span key={n ?? '+'} initial={false} animate={{ x: fan ? dirX(i * 6, dir) : 0 }} transition={spring(0.3, 0.35)} className={cn(i > 0 && '-ms-2')} style={{ zIndex: 10 - i }}>
            {n ? <Avatar name={n} size={size} />
              : <span className="grid place-items-center rounded-full border-2 border-[var(--card)] bg-[var(--muted)] text-xs font-semibold text-[var(--fg2)]" style={{ width: size, height: size }}>+{fmt.number(extra)}</span>}
          </motion.span>
        ))}
      </div>
      {caption && <span className="text-xs text-[var(--fg3)]">{caption}</span>}
    </div>
  )
}

/** The CSS transition AnimatedNumber's digit columns and SparkChart's marks use (off for reduced motion). */
const ROLL_EASE = 'cubic-bezier(.22,1,.36,1)'

/**
 * Rolling number (replaces the NumberFlow web component): each digit rolls to its new value.
 * format: Intl.NumberFormatOptions, e.g. { style: 'currency', currency: 'EUR' }.
 * Screen readers get the formatted value as visually hidden text (the rolling columns are aria-hidden). Digits are
 * tabular and each takes one fixed column, so the number never shifts the layout around it while it rolls.
 * Cheap enough for live tickers: each digit is one CSS transform transition (one style write per change, none per
 * frame), nothing is written when a digit is unchanged, and the roll is skipped (the digit jumps) for reduced motion
 * and while the number is off screen.
 */
export function AnimatedNumber({ value, format, locale, className }:
  { value: number; format?: Intl.NumberFormatOptions; /** default: the provider's locale */ locale?: string; className?: string }) {
  const ctx = useLocale(), loc = locale ?? ctx.locale
  const str = useMemo(() => numberFormat(loc, format).format(value), [value, format, loc])
  // the locale's own digits (Arabic-Indic for ar-EG …), so every script rolls, not just 0–9
  const glyphs = useMemo(() => { const nf = numberFormat(loc, { useGrouping: false }); return [...'0123456789'].map(d => nf.format(Number(d))) }, [loc])
  const ref = useRef<HTMLSpanElement>(null)
  const visible = useInView(ref, { margin: '64px' })
  // digits and their separators form left-to-right runs (numbers read LTR in RTL scripts too); text around them
  // (currency, %) follows the surrounding direction, as the browser's bidi algorithm would place it
  const chars = [...str], runs: { num: boolean; chars: [string, number][] }[] = []
  chars.forEach((c, i) => {
    const num = glyphs.includes(c) || (/[.,'’٫٬\u00a0\u202f\s]/.test(c) && glyphs.includes(chars[i - 1] ?? '') && glyphs.includes(chars[i + 1] ?? ''))
    const last = runs[runs.length - 1]
    if (last && last.num === num) last.chars.push([c, i]); else runs.push({ num, chars: [[c, i]] })
  })
  const cell = ([c, i]: [string, number]) => {
    const key = chars.length - i // key from the end so digits keep their column as the number grows
    const d = glyphs.indexOf(c)
    if (d < 0) return <span key={`s${key}`}>{c}</span>
    return (
      <span key={key} className="relative inline-block h-[1em] overflow-hidden text-center" style={{ width: '1ch' }}>
        <span className={cn('absolute inset-x-0 top-0 flex flex-col motion-reduce:!transition-none', !visible && '!transition-none')}
          style={{ transform: `translateY(${-d}em)`, transition: `transform .6s ${ROLL_EASE}` }}>
          {glyphs.map(g => <span key={g} className="h-[1em] leading-none">{g}</span>)}
        </span>
      </span>
    )
  }
  return (
    <span ref={ref} className={cn('ui-num inline-flex leading-none whitespace-nowrap', className)}>
      <span className="sr-only">{str}</span>
      <span aria-hidden className="inline-flex">
        {runs.map((r, k) => r.num ? <span key={'n' + (runs.length - k)} dir="ltr" className="inline-flex">{r.chars.map(cell)}</span> : r.chars.map(cell))}
      </span>
    </span>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
 * Sparklines: word-sized charts. Here (not in charts) so the foundation bundle (stat cards, kanban metrics) can use
 * them; the chart kit imports SparkChart and chartPath from core.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Curve shape for line paths: straight segments or a monotone cubic. */
export type Curve = 'linear' | 'monotone'

/** SVG path through points (the chart kit and SparkChart share it). 'monotone' is a monotone cubic (Fritsch–Carlson): smooth, never overshoots the data. */
export function chartPath(pts: [number, number][], curve: Curve = 'linear', join = false) {
  if (!pts.length) return ''
  const head = `${join ? 'L' : 'M'}${sparkP1(pts[0][0])},${sparkP1(pts[0][1])}`
  if (curve === 'linear' || pts.length < 2) return head + pts.slice(1).map(p => `L${sparkP1(p[0])},${sparkP1(p[1])}`).join('')
  const n = pts.length, dx: number[] = [], m: number[] = [], t: number[] = []
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0 }
  t[0] = m[0]; t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i])
  let d = head
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = dx[i] / 3
    d += `C${sparkP1(x0 + h)},${sparkP1(y0 + t[i] * h)},${sparkP1(x1 - h)},${sparkP1(y1 - t[i + 1] * h)},${sparkP1(x1)},${sparkP1(y1)}`
  }
  return d
}

const sparkP1 = (n: number) => n.toFixed(1)

/** Width plus a flag that turns true once the element has scrolled into view. */
function useSparkFrame(amount: number) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const seen = useInView(ref, { once: true, amount })
  return [ref, w, seen] as const
}

export type SparkVariant = 'line' | 'bars' | 'winloss' | 'area'

/**
 * Word-sized chart for tables and tiles. Variants: 'line' (optional end dot and min/max dots), 'bars' (last bar highlighted),
 * 'winloss' (up/down against the previous value) and 'area' (optional dashed `target`). Fills its container's width unless `width` is set.
 */
export function SparkChart({ data, variant = 'line', width, height = 36, color = 'var(--accent)', curve = 'linear', endDot, minMax, target, className }:
  { data: number[]; variant?: SparkVariant; width?: number; height?: number; color?: string; curve?: Curve; endDot?: boolean; minMax?: boolean; target?: number; className?: string }) {
  const [ref, mw, seen] = useSparkFrame(0.1)
  // fewer than two points has no shape to draw (and Math.min() of nothing is Infinity): keep the box, draw nothing
  if (data.length < 2) return <div ref={ref} className={cn('min-w-0', className)} style={{ width: width ?? '100%', height }} />
  const W = width ?? mw, H = height, pad = variant === 'line' || variant === 'area' ? 4 : 0
  const lo = minOf(data, target ?? Infinity), hi = maxOf(data, target ?? -Infinity)
  const n = data.length, Y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2)
  const pts = data.map((v, i) => [(i / Math.max(1, n - 1)) * W, Y(v)] as [number, number])
  const flat = pts.map(p => [p[0], H - pad] as [number, number])
  const P = seen ? pts : flat, line = chartPath(P, curve)
  const bw = W / n, mi = data.indexOf(minOf(data)), ma = data.indexOf(maxOf(data))
  // Every mark moves by CSS transitions (paths through the CSS `d` property, dots and bars by transform), so a live
  // update is one style write per mark and the browser interpolates: no per-frame attribute writes. Reduced motion jumps.
  const ease = `.45s ${ROLL_EASE}`
  const path = (d: string): CSSProperties => ({ d: `path("${d}")`, transition: `d ${ease}` } as CSSProperties)
  const dot = (x: number, y: number): CSSProperties => ({ transform: `translate(${sparkP1(x)}px,${sparkP1(y)}px)`, transition: `transform ${ease}, fill ${ease}` })
  const bar = (k: number, originY: number): CSSProperties => ({ transform: `scaleY(${k})`, transformOrigin: `0 ${originY}px`, transition: `transform ${ease}` })
  const still = 'motion-reduce:!transition-none'
  return (
    <div ref={ref} className={cn('min-w-0', className)} style={{ width: width ?? '100%', height: H }}>
      {W > 0 && (
        <svg width={W} height={H} className="block overflow-visible" aria-hidden>
          {variant === 'area' && <path className={still} d={`${line}L${sparkP1(W)},${H}L0,${H}Z`} style={path(`${line}L${sparkP1(W)},${H}L0,${H}Z`)} fill={color} fillOpacity={0.15} />}
          {variant === 'area' && target !== undefined && <line x1={0} x2={W} y1={Y(target)} y2={Y(target)} stroke="var(--fg3)" strokeDasharray="3 3" />}
          {(variant === 'line' || variant === 'area') && <path className={still} d={line} style={path(line)} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />}
          {variant === 'line' && minMax && seen && <>
            <circle className={still} r={2.6} fill="var(--bad)" style={dot(pts[mi][0], pts[mi][1])} />
            <circle className={still} r={2.6} fill="var(--ok)" style={dot(pts[ma][0], pts[ma][1])} />
          </>}
          {(variant === 'line' || variant === 'area') && (endDot || minMax) && <circle className={still} r={2.6} fill={minMax ? 'var(--accent)' : color} style={dot(P[n - 1][0], P[n - 1][1])} />}
          {variant === 'bars' && data.map((v, i) => {
            // a full-height bar scaled from the bottom edge: its attributes never change, only its transform
            const k = seen ? (4 + ((v - lo) / (hi - lo || 1)) * (H - 6)) / (H - 2) : 0
            return <rect key={i} className={still} x={i * bw + 0.6} y={2} width={Math.max(0.5, bw - 1.2)} height={H - 2} fill={i === n - 1 ? color : 'var(--line2)'} style={bar(k, H)} />
          })}
          {variant === 'winloss' && <>
            <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--line2)" />
            {data.map((v, i) => {
              if (!i) return null
              // drawn above the baseline and mirrored below it with scaleY(-1): a change of direction flips through 0
              const up = v >= data[i - 1], h = H * 0.3
              return <rect key={i} className={still} x={i * bw + 0.6} y={H / 2 - 1 - h} width={Math.max(0.5, bw - 1.2)} height={h} fill={up ? 'var(--ok)' : 'var(--bad)'} opacity={0.85}
                style={bar(seen ? (up ? 1 : -1) : 0, H / 2)} />
            })}
          </>}
        </svg>
      )}
    </div>
  )
}
