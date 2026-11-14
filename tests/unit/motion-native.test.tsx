// The native animation layer that replaced motion in core: spring easings, presence, keyed lists, play() and in-view.
import { act, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { springEasing, useInView, usePresence } from '../../src/lib/core'
import { ActiveIndicator, Presence, PresenceList, Swap, play } from '../../src/lib/motion'
import { TagInput } from '../../src/lib/forms'
import { withMotion } from '../helpers'

const points = (e: string) => e.slice('linear('.length, -1).split(',').map(Number)

describe('springEasing', () => {
  it('ends at 1, overshoots with bounce and rises monotonically without', () => {
    const bouncy = points(springEasing(0.5, 0.35).easing), flat = points(springEasing(0, 0.4).easing)
    expect(bouncy[0]).toBe(0)
    expect(bouncy.at(-1)).toBe(1)
    expect(Math.max(...bouncy)).toBeGreaterThan(1.05)
    expect(flat.every((v, i) => i === 0 || v >= flat[i - 1])).toBe(true)
    expect(Math.max(...flat)).toBeLessThanOrEqual(1)
    expect(springEasing(0.25, 0.45).ms).toBe(450)
  })
})

/** A fake running animation whose `finished` resolves when `end()` is called. */
function pendingAnimation() {
  let end = () => {}
  const finished = new Promise<void>(r => { end = r })
  return { anim: { finished, effect: { getComputedTiming: () => ({ endTime: 150 }) } } as unknown as Animation, end }
}

/** Every element reports `anim` from getAnimations() (jsdom has none) until the test ends. */
function stubAnimations(anim: Animation) {
  const proto = Element.prototype as { getAnimations?: () => Animation[] }
  proto.getAnimations = () => [anim]
  onTestFinished(() => { delete proto.getAnimations })
}

function Toggle({ initial = true }: { initial?: boolean }) {
  const [show, setShow] = useState(initial)
  const p = usePresence<HTMLDivElement>(show)
  return (
    <>
      <button onClick={() => setShow(s => !s)}>toggle</button>
      {p.mounted && <div ref={p.ref} data-testid="box" data-exiting={p.exiting || undefined} data-enter={p.enter || undefined}>box</div>}
    </>
  )
}

describe('usePresence', () => {
  it('unmounts at once when nothing animates', () => {
    render(<Toggle />)
    act(() => screen.getByText('toggle').click())
    expect(screen.queryByTestId('box')).toBeNull()
  })

  it('waits for the exit animations before unmounting', async () => {
    const { anim, end } = pendingAnimation()
    stubAnimations(anim)
    render(<Toggle />)
    act(() => screen.getByText('toggle').click())
    expect(screen.getByTestId('box')).toHaveAttribute('data-exiting')
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('box')).toBeInTheDocument() // still leaving
    await act(async () => { end(); await anim.finished })
    expect(screen.queryByTestId('box')).toBeNull()
  })

  it('showing again cancels the exit: the old exit animation finishing later neither unmounts nor replays the entrance', async () => {
    const first = pendingAnimation(), second = pendingAnimation()
    let current = first.anim
    const proto = Element.prototype as { getAnimations?: () => Animation[] }
    proto.getAnimations = () => [current]
    onTestFinished(() => { delete proto.getAnimations })
    render(<Toggle />)
    act(() => screen.getByText('toggle').click()) // hide: the first exit starts
    act(() => screen.getByText('toggle').click()) // show again before it ends
    expect(screen.getByTestId('box')).not.toHaveAttribute('data-exiting')
    current = second.anim
    act(() => screen.getByText('toggle').click()) // hide again: a second exit
    await act(async () => { first.end(); await first.anim.finished })
    expect(screen.getByTestId('box')).toHaveAttribute('data-exiting') // the cancelled exit did not end this one
    act(() => screen.getByText('toggle').click()) // show again
    await act(async () => { second.end(); await second.anim.finished })
    expect(screen.getByTestId('box')).not.toHaveAttribute('data-enter') // no entrance replay for a box that never left
    expect(screen.getByTestId('box')).not.toHaveAttribute('data-exiting')
  })
})

describe('Presence, PresenceList and Swap', () => {
  it('Presence marks its child as leaving and skips the entrance of a child shown on the first render', () => {
    const { anim } = pendingAnimation()
    function P() {
      const [on, setOn] = useState(true)
      return <><button onClick={() => setOn(o => !o)}>t</button><Presence>{on && <p className="ui-in">hello</p>}</Presence></>
    }
    render(<P />)
    expect(screen.getByText('hello')).toHaveAttribute('data-ui-still')
    stubAnimations(anim)
    act(() => screen.getByText('t').click())
    const leaving = screen.getByText('hello', { selector: '[data-ui-exit]' })
    expect(leaving).toHaveAttribute('inert')
  })

  it('PresenceList keeps a removed item in its place while it leaves', () => {
    const { anim } = pendingAnimation()
    function L() {
      const [items, setItems] = useState(['a', 'b', 'c'])
      return <><button onClick={() => setItems(['a', 'c', 'd'])}>go</button>
        <ul>{<PresenceList items={items} keyOf={s => s}>{s => <li className="ui-in">{s}</li>}</PresenceList>}</ul></>
    }
    render(<L />)
    stubAnimations(anim)
    act(() => screen.getByText('go').click())
    expect(screen.getAllByRole('listitem', { hidden: true }).map(li => li.textContent)).toEqual(['a', 'b', 'c', 'd'])
    expect(screen.getByText('b')).toHaveAttribute('data-ui-exit')
    expect(screen.getByText('d')).not.toHaveAttribute('data-ui-still')
  })

  it('a component child (TagInput chips) gets the leaving attributes on its root element', () => {
    render(<TagInput defaultValue={['design', 'research']} />)
    stubAnimations(pendingAnimation().anim)
    act(() => screen.getByRole('button', { name: 'Remove design' }).click())
    expect(screen.getByText('design').closest('[data-ui-exit]')).toHaveAttribute('inert')
    expect(screen.getByText('research').closest('[data-ui-exit]')).toBeNull()
  })

  it('Swap replaces its child when the key changes', () => {
    function S() {
      const [k, setK] = useState(0)
      return <><button onClick={() => setK(n => n + 1)}>next</button><span><Swap k={k}><b className="ui-in">v{k}</b></Swap></span></>
    }
    render(<S />)
    act(() => screen.getByText('next').click())
    expect(screen.queryByText('v0')).toBeNull()
    expect(screen.getByText('v1')).not.toHaveAttribute('data-ui-still')
  })
})

describe('play', () => {
  it('does nothing for reduced motion and maps keyframes to transforms otherwise', () => {
    const el = document.createElement('div')
    const animate = vi.fn(() => ({}) as Animation)
    el.animate = animate
    play(el, { scale: [0.8, 1] })
    expect(animate).not.toHaveBeenCalled()
    withMotion()
    play(el, { x: [0, -4, 0] }, { duration: 0.32, ease: [0.22, 1, 0.36, 1] })
    expect(animate).toHaveBeenCalledWith(
      [{ transform: 'translate(0px,0px) scale(1) rotate(0deg)' }, { transform: 'translate(-4px,0px) scale(1) rotate(0deg)' }, { transform: 'translate(0px,0px) scale(1) rotate(0deg)' }],
      expect.objectContaining({ duration: 320, easing: 'cubic-bezier(0.22,1,0.36,1)' }))
    play(el, { scale: [0.8, 1] }, { type: 'spring', bounce: 0.5, duration: 0.3 })
    expect(animate).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ duration: 300, easing: expect.stringMatching(/^linear\(/) }))
  })
})

describe('useInView and ActiveIndicator', () => {
  it('useInView follows the IntersectionObserver', () => {
    let report: (v: boolean) => void = () => {}
    vi.stubGlobal('IntersectionObserver', class {
      cb: IntersectionObserverCallback
      constructor(cb: IntersectionObserverCallback) { this.cb = cb }
      observe(el: Element) { report = v => this.cb([{ isIntersecting: v, intersectionRatio: v ? 1 : 0, target: el } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
      unobserve() {} disconnect() {}
    })
    function V() { const ref = useRef<HTMLDivElement>(null); return <div ref={ref}>{useInView(ref) ? 'in' : 'out'}</div> }
    render(<V />)
    expect(screen.getByText('out')).toBeInTheDocument()
    act(() => report(true))
    expect(screen.getByText('in')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('ActiveIndicator is decorative and slides from the old item to the new one', () => {
    withMotion()
    // each item reports its own place; the indicator fills the item it is in
    const rects: Record<string, DOMRect> = { a: new DOMRect(0, 0, 60, 30), b: new DOMRect(100, 0, 80, 30) }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return rects[(this.closest('[data-item]') as HTMLElement | null)?.dataset.item ?? ''] ?? new DOMRect()
    })
    const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel() {} }) as unknown as Animation)
    const proto = Element.prototype as { animate?: unknown }
    proto.animate = animate
    onTestFinished(() => { delete proto.animate })
    function Tabs() {
      const [on, setOn] = useState('a')
      return <div role="tablist">{['a', 'b'].map(k => (
        <button key={k} role="tab" aria-selected={on === k} data-item={k} onClick={() => setOn(k)}>{k}{on === k && <ActiveIndicator group="g" />}</button>
      ))}</div>
    }
    render(<Tabs />)
    expect(screen.getByRole('tab', { name: 'a' }).querySelectorAll('span[aria-hidden]')).toHaveLength(1)
    expect(animate).not.toHaveBeenCalled() // nothing to slide from on the first render
    act(() => screen.getByRole('tab', { name: 'b' }).click())
    expect(screen.getByRole('tab', { name: 'a' }).querySelector('span[aria-hidden]')).toBeNull()
    expect(screen.getByRole('tab', { name: 'b' }).querySelectorAll('span[aria-hidden]')).toHaveLength(1)
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate).toHaveBeenCalledWith([
      { transform: 'translate(-100px,0px)', width: '60px', height: '30px' },
      { transform: 'none', width: '80px', height: '30px' },
    ], expect.objectContaining({ duration: expect.any(Number) }))
  })
})
