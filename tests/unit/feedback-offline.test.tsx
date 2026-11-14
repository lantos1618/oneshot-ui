// OfflineIndicator (0.5): one persistent bar whose content cross-fades in place, a live region that speaks only on
// state changes (never the countdown), a calm "Retrying…" at each retry, `paused` (e.g. off screen).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfflineIndicator } from '../../src/lib'

const live = () => screen.getAllByRole('status').find(el => el.classList.contains('sr-only'))!
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
/** Is "Retrying…" the one shown (with its spinner), rather than the countdown? Both stay in the cell; one is faded out. */
const retryingShown = () => {
  const label = screen.getByText('Retrying…'), countdown = screen.getByText(/Retrying in/)
  const spinner = within(label).queryByRole('status', { hidden: true })
  const shown = label.classList.contains('opacity-100') && countdown.classList.contains('opacity-0')
  expect(!!spinner, 'spinner shown with the label').toBe(shown)
  return shown
}

describe('OfflineIndicator', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('shows the offline bar without announcing on mount, counts down, retries and shows "Retrying…" in place', () => {
    const onRetry = vi.fn()
    render(<OfflineIndicator online={false} onRetry={onRetry} retryEvery={3} />)
    expect(screen.getByText('You’re offline. Edits are saved locally.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument()
    expect(live()).toHaveTextContent(/^$/) // nothing to announce until the state changes
    const countdown = screen.getByText(/Retrying in/).closest('[aria-hidden]')
    expect(countdown).not.toBeNull() // the countdown is hidden from screen readers
    tick(1000)
    expect(screen.getByText(/Retrying in/).textContent).toMatch(/2 s$/)
    expect(retryingShown()).toBe(false)
    tick(2000)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(retryingShown()).toBe(true) // "Retrying…" with its spinner, in place of the countdown
    expect(live()).toHaveTextContent(/^$/) // still silent: retries are not state changes
    // the countdown restarted from 3, and comes back after a second
    expect(screen.getByText(/Retrying in/).textContent).toMatch(/3 s$/)
    tick(1000)
    expect(retryingShown()).toBe(false)
    expect(screen.getByText(/Retrying in/).textContent).toMatch(/2 s$/)
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(retryingShown()).toBe(true)
  })

  it('hides the "Back online" bar after a moment, and says nothing more', () => {
    const { rerender } = render(<OfflineIndicator online={false} retryEvery={5} />)
    rerender(<OfflineIndicator online retryEvery={5} />)
    expect(screen.getByText('Back online.', { selector: 'span:not(.sr-only)' })).toBeInTheDocument()
    tick(2000)
    expect(screen.getByText('Back online.', { selector: 'span:not(.sr-only)' })).toBeInTheDocument()
    tick(500)
    expect(screen.queryByText('Back online.', { selector: 'span:not(.sr-only)' })).toBeNull()
    expect(screen.queryByText(/Retrying in/)).toBeNull()
    expect(live()).toHaveTextContent(/^$/)
  })

  it('announces only the state changes, with one bar that changes tone in place', () => {
    const { rerender } = render(<OfflineIndicator online retryEvery={5} />)
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull()
    rerender(<OfflineIndicator online={false} retryEvery={5} />)
    expect(live()).toHaveTextContent('You’re offline. Retrying automatically.')
    for (let i = 0; i < 4; i++) { tick(1000); expect(live()).toHaveTextContent('You’re offline. Retrying automatically.') }
    rerender(<OfflineIndicator online retryEvery={5} backMessage="Back online. Synced 3 changes." />)
    expect(live()).toHaveTextContent('Back online. Synced 3 changes.')
    // the same bar holds both states (no second banner stacked under an exiting one)
    expect(screen.getAllByText(/Retrying in/)).toHaveLength(1)
    expect(screen.getAllByText('Back online. Synced 3 changes.', { selector: 'span:not(.sr-only)' })).toHaveLength(1)
    rerender(<OfflineIndicator online={false} retryEvery={5} />) // offline again while "Back online" shows
    expect(live()).toHaveTextContent('You’re offline. Retrying automatically.')
    expect(screen.getAllByText(/Retrying in/)).toHaveLength(1)
  })

  it('paused stops the countdown and automatic retries; Retry now still works', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<OfflineIndicator online={false} onRetry={onRetry} retryEvery={2} paused />)
    tick(10_000)
    expect(onRetry).not.toHaveBeenCalled()
    expect(screen.getByText(/Retrying in/).textContent).toMatch(/2 s$/)
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    rerender(<OfflineIndicator online={false} onRetry={onRetry} retryEvery={2} paused={false} />)
    tick(2000)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

})
