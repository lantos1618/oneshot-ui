import type { ReactNode } from 'react'
import { cn } from '../lib/core'
/* Phone frame (an example, not part of the stable API; moved out of navigation in 0.4): a device mock for demos. */

/**
 * Phone-shaped frame for previewing mobile layouts (docs, marketing, onboarding). Children fill the screen as a flex column;
 * put a tab bar at the bottom. `width`/`height` size the device (it never exceeds its container), `notch={false}` drops the
 * camera pill, and `label` names it for screen readers (e.g. "Preview of the inbox on a phone").
 */
export function PhoneFrame({ children, width = 250, height = 440, notch = true, label, className }:
  { children: ReactNode; width?: number; height?: number; notch?: boolean; label?: string; className?: string }) {
  return (
    <div role={label ? 'figure' : undefined} aria-label={label} style={{ width, height }}
      className={cn('relative flex max-w-full flex-none flex-col overflow-hidden rounded-[36px] border-8 border-[var(--fg)] bg-[var(--bg)] shadow-[var(--shadow)]', className)}>
      {notch && <span aria-hidden className="absolute top-1.5 left-1/2 z-10 h-[18px] w-[72px] -translate-x-1/2 rounded-full bg-[var(--fg)]" />}
      {children}
    </div>
  )
}
