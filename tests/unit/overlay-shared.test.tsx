// Modal state shared across drop-in copies of the library.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Dialog } from '../../src/lib/overlay'

/** Inside an inert subtree? (jsdom keeps `inert` as a property only.) */
const isInert = (el: Element | null) => { for (let n = el as HTMLElement | null; n; n = n.parentElement) if (n.inert) return true; return false }

describe('modal state shared by drop-in copies', () => {
  it('stacks dialogs from two copies of the module: inert and scroll lock unwind in order', async () => {
    // a second, independent copy of the overlay module, as a drop-in file would be (its own module-level code)
    vi.resetModules()
    const copy = await import('../../src/lib/overlay?copy=2' as string) as typeof import('../../src/lib/overlay')
    expect(copy.Dialog).not.toBe(Dialog)
    document.documentElement.style.overflow = 'clip' // a host style the lock must put back
    onTestFinished(() => { document.documentElement.style.overflow = '' })
    function Page() {
      const [outer, setOuter] = useState(false), [inner, setInner] = useState(false)
      return (
        <div>
          <button onClick={() => setOuter(true)}>Open outer</button>
          <main data-testid="page">Page content</main>
          <Dialog.Root open={outer} onOpenChange={setOuter}>
            <Dialog.Content aria-label="Outer">
              <button onClick={() => setInner(true)}>Open inner</button>
              <copy.Dialog.Root open={inner} onOpenChange={setInner}>
                <copy.Dialog.Content aria-label="Inner"><copy.Dialog.Close>Close inner</copy.Dialog.Close></copy.Dialog.Content>
              </copy.Dialog.Root>
            </Dialog.Content>
          </Dialog.Root>
        </div>
      )
    }
    const user = userEvent.setup()
    render(<Page />)
    const pageInert = () => isInert(screen.getByTestId('page'))
    await user.click(screen.getByRole('button', { name: 'Open outer' }))
    await waitFor(() => expect(pageInert()).toBe(true))
    expect(document.documentElement.style.overflow).toBe('hidden')
    await user.click(screen.getByRole('button', { name: 'Open inner' }))
    const outer = screen.getByRole('dialog', { name: 'Outer' })
    // the inner dialog (other copy) is now the top layer: the outer panel is inert, the inner one is not
    await waitFor(() => expect(isInert(outer)).toBe(true))
    const inner = screen.getByRole('dialog', { name: 'Inner' })
    expect(isInert(inner)).toBe(false)
    // Escape closes only the top one, and hands the page back to the outer dialog
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull())
    await waitFor(() => expect(isInert(outer)).toBe(false))
    expect(document.documentElement.style.overflow).toBe('hidden') // still locked: the outer one is open
    expect(pageInert()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Outer' })).toBeNull())
    await waitFor(() => expect(pageInert()).toBe(false))
    expect(document.documentElement.style.overflow).toBe('clip') // the host's own style is restored
  })
})

