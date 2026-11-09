// 0.4 consolidation: merged components (Collapse/AutoHeight, sources, AgentComposer on PromptInput), the statechart
// presets without sample data, the lazily loaded map data, and the blocks and examples moved out of the stable API.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import * as lib from '../../src/lib'
import { UIProvider } from '../../src/lib/provider'
import { AutoHeight, Collapse, ToastProvider } from '../../src/lib/feedback'
import { Citation, PromptInput, SourceList, SourcesPanel, sourceDomain } from '../../src/lib/ai'
import { AgentComposer, ChatSources } from '../../src/lib/aichat'
import { StateMachine } from '../../src/lib/statechart'
import { AgentTransitMap } from '../../src/lib/aiagent'
import { Globe, WorldMap, loadWorldMap } from '../../src/lib/geo'
import { AGENT_WORKFLOWS, AGENT_WORKFLOW_ORDER, AI_CANVAS_SAMPLE, describeSample } from '../../src/examples'

describe('stable API', () => {
  it('no longer exports sample data, demo helpers or page blocks', () => {
    for (const name of ['AI_CANVAS_SAMPLE', 'AGENT_WORKFLOWS', 'AGENT_WORKFLOW_ORDER', 'mediaArt', 'mediaImage', 'mediaSynthTrack', 'mediaRecordVideo',
      'describeSample', 'MotionPlayground', 'WORLD_MAP', 'GLOBE_LAND', 'PricingTable', 'Checkout', 'ProfileCard', 'OnboardingChecklist', 'CookieConsent'])
      expect(lib, name).not.toHaveProperty(name)
  })
  it('examples still provide them', () => {
    expect(Object.keys(AGENT_WORKFLOWS)).toEqual(expect.arrayContaining(AGENT_WORKFLOW_ORDER))
    expect(AI_CANVAS_SAMPLE.edits.length).toBeGreaterThan(0)
    expect(describeSample([1, 2, 3])).toMatchObject({ n: 3, mean: 2, sd: 1 })
  })
})

describe('Collapse / AutoHeight', () => {
  it('mounts its content only while open', () => {
    const { rerender } = render(<Collapse open={false}><p>Details</p></Collapse>)
    expect(screen.queryByText('Details')).toBeNull()
    rerender(<Collapse open><p>Details</p></Collapse>)
    expect(screen.getByText('Details')).toBeInTheDocument()
  })
  it('AutoHeight (Collapse without open) always shows its content', () => {
    render(<AutoHeight><p>Step 2</p></AutoHeight>)
    expect(screen.getByText('Step 2')).toBeInTheDocument()
  })
})

describe('sources', () => {
  it('one Source model: domain falls back to the URL host', () => {
    expect(sourceDomain({ title: 'A', url: 'https://docs.example.com/x' })).toBe('docs.example.com')
    expect(sourceDomain({ title: 'A', domain: 'Slack', url: 'https://x.dev' })).toBe('Slack')
    expect(sourceDomain({ title: 'A' })).toBe('')
  })
  it('SourceList links each source; ChatSources is an alias with the old item shape', () => {
    const { container, unmount } = render(<SourceList sources={[{ title: 'Docs', url: 'https://docs.example.com/a' }, { title: 'Bad', url: 'javascript:alert(1)' }]} />)
    const links = within(container).getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', 'https://docs.example.com/a')
    expect(links[0]).toHaveTextContent('docs.example.com')
    expect(links[1].getAttribute('href')).not.toMatch(/^javascript:/i)
    unmount()
    render(<ChatSources items={[{ name: 'Linear', desc: 'Weekly digest' }]} />)
    expect(screen.getByRole('link')).toHaveTextContent(/Linear\s*Weekly digest/)
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
  it('AgentTransitMap renders without machines', () => {
    expect(() => render(<AgentTransitMap />)).not.toThrow()
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
  it('Globe renders before its land points arrive', () => {
    expect(() => render(<UIProvider persist={false}><Globe hubs={[['A', 0, 0], ['B', 10, 10]]} routes={[{ from: 0, to: 1, color: 'var(--c2)' }]} /></UIProvider>)).not.toThrow()
  })
})
