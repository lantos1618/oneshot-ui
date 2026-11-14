// 0.4 consolidation: merged components (Collapse/AutoHeight, sources, AgentComposer on PromptInput), the statechart
// presets without sample data, the lazily loaded map data, and the blocks and examples moved out of the stable API.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as lib from '../../src/lib/all'
import { UIProvider } from '../../src/lib/provider'
import { AutoHeight, Collapse, ToastProvider } from '../../src/lib/feedback'
import { Citation, PromptInput, SourceList, SourcesPanel, sourceDomain } from '../../src/lib/ai'
import { AgentComposer } from '../../src/lib/aichat'
import { StateMachine } from '../../src/lib/statechart'
import { AgentTransitMap } from '../../src/lib/aiagent'
import { Globe, WorldMap, loadGlobeLand, loadWorldMap } from '../../src/lib/geo'
import * as examples from '../../src/examples'
import * as blocks from '../../src/blocks'
import { AGENT_WORKFLOWS, AGENT_WORKFLOW_ORDER } from '../../src/examples'

describe('stable API', () => {
  it('exports none of the sample data, demo helpers or page blocks', () => {
    // whatever the showcase's examples and blocks export (renamed or new), the library exports none of it
    const leaked = [...Object.keys(examples), ...Object.keys(blocks)].filter(name => name in lib)
    expect(leaked).toEqual([])
    expect(Object.keys(examples)).toEqual(expect.arrayContaining(['AGENT_WORKFLOWS', 'AI_CANVAS_SAMPLE', 'describeSample'])) // the check has something to check
    expect(Object.keys(blocks)).toEqual(expect.arrayContaining(['Checkout', 'PricingTable']))
  })
})

describe('Collapse / AutoHeight', () => {
  it('mounts its content only while open', () => {
    const { rerender } = render(<Collapse open={false}><p>Details</p></Collapse>)
    expect(screen.queryByText('Details')).toBeNull()
    rerender(<Collapse open><p>Details</p></Collapse>)
    expect(screen.getByText('Details')).toBeInTheDocument()
  })
  it('AutoHeight (Collapse without open) shows its content and its height follows the content', () => {
    let resized = () => {}
    vi.stubGlobal('ResizeObserver', class { constructor(cb: ResizeObserverCallback) { resized = () => cb([], this as unknown as ResizeObserver) } observe() {} unobserve() {} disconnect() {} })
    onTestFinished(() => { vi.unstubAllGlobals() })
    let content = 40
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => content)
    render(<AutoHeight><p>Step 2</p></AutoHeight>)
    const box = screen.getByText('Step 2').parentElement!.parentElement!
    expect(box.style.height).toBe('40px')
    content = 96 // the step's content grows
    act(() => resized())
    expect(box.style.height).toBe('96px')
    content = 24
    act(() => resized())
    expect(box.style.height).toBe('24px')
  })
})

describe('sources', () => {
  it('one Source model: domain falls back to the URL host', () => {
    expect(sourceDomain({ title: 'A', url: 'https://docs.example.com/x' })).toBe('docs.example.com')
    expect(sourceDomain({ title: 'A', domain: 'Slack', url: 'https://x.dev' })).toBe('Slack')
    expect(sourceDomain({ title: 'A' })).toBe('')
  })
  it('SourceList links each source and neutralises unsafe URLs', () => {
    const { container, unmount } = render(<SourceList sources={[{ title: 'Docs', url: 'https://docs.example.com/a' }, { title: 'Bad', url: 'javascript:alert(1)' }]} />)
    const links = within(container).getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', 'https://docs.example.com/a')
    expect(links[0]).toHaveTextContent('docs.example.com')
    expect(links[1].getAttribute('href')).not.toMatch(/^javascript:/i)
    unmount()
  })
  it('Citation and SourcesPanel take the same Source', () => {
    const s = { title: 'Pricing study', url: 'https://research.example.com/p', snippet: 'Annual plans churn less.' }
    render(<><p>Claim<Citation n={1} source={s} /></p><SourcesPanel answer="Answer [1]." sources={[s]} /></>)
    expect(screen.getAllByRole('button', { name: 'Source 1: Pricing study' })).toHaveLength(2)
  })
})

describe('PromptInput as a composer base', () => {
  it('canSubmit and sendButton override the defaults; header and aside render', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(() => false as const), onClick = vi.fn()
    render(<PromptInput onSubmit={onSubmit} canSubmit header={<span>ctx chip</span>} aside={<span>1 queued</span>}
      sendButton={{ state: 'queue', disabled: false, onClick }} />)
    expect(screen.getByText('ctx chip')).toBeInTheDocument()
    expect(screen.getByText('1 queued')).toBeInTheDocument()
    await user.click(screen.getByRole('textbox', { name: 'Message' }))
    await user.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('', [])
    await user.click(screen.getByRole('button', { name: 'Queue message' }))
    expect(onClick).toHaveBeenCalled()
  })
  it('AgentComposer sends through it', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<ToastProvider><AgentComposer onSend={onSend} /></ToastProvider>)
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello{Enter}')
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Hello', [], [], expect.objectContaining({ connectors: [] })))
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
  })
})

describe('statechart presets without sample data', () => {
  it('StateMachine renders empty, with Fire event disabled', () => {
    render(<StateMachine />)
    expect(screen.getByRole('img', { name: /no workflows/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fire event' })).toBeDisabled()
  })
  it('StateMachine runs the machines it is given', () => {
    render(<StateMachine machines={AGENT_WORKFLOWS} order={AGENT_WORKFLOW_ORDER} />)
    expect(screen.getByRole('img', { name: 'Feature spec statechart' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fire event' })).toBeEnabled()
  })
  it('AgentTransitMap without a run draws the empty map: no queue, no trace, no traffic', () => {
    render(<AgentTransitMap />)
    expect(screen.getAllByRole('img')).toEqual([screen.getByRole('img', { name: 'Transit map of agent teams' })])
    expect(screen.getByText('Intake')).toBeInTheDocument() // the stations are there
    expect(screen.queryByText('Event queue')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('row')).toBeNull()
  })
})

describe('geo data loads lazily', () => {
  it('WorldMap shows a busy placeholder, then the countries', async () => {
    render(<WorldMap data={{ Germany: { users: 3 } }} metrics={[{ key: 'users', label: 'Users', format: v => String(v) }]} />)
    const map = screen.getByRole('img', { name: 'World map by users' })
    expect(map.querySelectorAll('path')).toHaveLength(0)
    await act(() => loadWorldMap())
    await waitFor(() => expect(map.querySelectorAll('path').length).toBeGreaterThan(100))
    expect(map.parentElement).toHaveAttribute('aria-busy', 'false')
  })
  it('WorldMap uses a map it is given', () => {
    render(<WorldMap map={{ w: 10, h: 5, countries: [['1', 'Box', 'M0,0L10,0L10,5Z']] }} data={{}} metrics={[{ key: 'm', label: 'M', format: String }]} />)
    expect(screen.getByRole('img', { name: 'World map by m' }).querySelectorAll('path')).toHaveLength(1)
  })
  it('Globe draws its routes before its land points arrive, and the land once they do', async () => {
    // a 2D context that counts the calls made on the globe's own canvas (jsdom has no canvas)
    const calls = new Map<HTMLCanvasElement, string[]>()
    const ctx = (cv: HTMLCanvasElement): CanvasRenderingContext2D => {
      const log = calls.get(cv) ?? (calls.set(cv, []), calls.get(cv)!)
      const p: object = new Proxy({}, { get: (_, k) => (...args: unknown[]) => { log.push(String(k)); void args; return p }, set: () => true })
      return p as CanvasRenderingContext2D
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) { return ctx(this) } as never)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
    render(<UIProvider persist={false}><Globe hubs={[['A', 0, 0], ['B', 10, 10]]} routes={[{ from: 0, to: 1, color: 'var(--c2)' }]} /></UIProvider>)
    const globe = screen.getByRole('img', { name: 'Rotating globe with routes between cities' }) as HTMLCanvasElement
    expect(screen.getByText('A → B')).toBeInTheDocument()
    const drawn = (op: string) => (calls.get(globe) ?? []).filter(c => c === op).length
    expect(drawn('stroke')).toBeGreaterThan(0) // the route is drawn already...
    expect(drawn('fillRect')).toBe(0) // ...with no land dots yet
    await act(() => loadGlobeLand())
    await waitFor(() => expect(drawn('fillRect')).toBeGreaterThan(100))
  })
})
