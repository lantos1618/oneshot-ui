// AI components: the injectable renderers that keep the chat drop-ins small (plain text / JSON by default, Markdown + CodeBlock + JsonViewer on request).
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AI_RICH_RENDERERS, AgentComposer, AiRenderersProvider, MessageParts, ToolCard, aiMarkdownText } from '../../src/lib/aichat'
import { Markdown } from '../../src/lib/markdown'
import { markdownCodeBlock } from '../../src/lib/code'
import { type AiMessage, type AiToolPart } from '../../src/lib/aistream'

const assistant = (text: string, extra: AiMessage['parts'] = []): AiMessage => ({ id: 'a', role: 'assistant', status: 'done', parts: [...extra, { type: 'text', text }] })

describe('MessageParts renderers', () => {
  it('renders text as Markdown by default: [n] as a citation, fences in the plain frame', () => {
    const m = assistant('**Bold** claim [1]\n\nHello world\n\n```ts\nconst a = 1\n```', [{ type: 'source', url: 'https://example.com/a', title: 'Source A' }])
    const { container } = render(<MessageParts message={m} />)
    expect(container.querySelector('strong')?.textContent).toBe('Bold')
    expect(screen.queryByText('TypeScript')).toBeNull() // no highlighter by default
    expect(container.querySelector('pre')?.textContent).toBe('const a = 1')
    expect(screen.getByRole('button', { name: 'Source 1: Source A' })).toBeInTheDocument()
    const ps = container.querySelectorAll('p')
    expect(ps).toHaveLength(2)
    expect(ps[1].textContent).toBe('Hello world')
  })

  it('highlights fences with AI_RICH_RENDERERS (prop) and takes renderers from a provider', () => {
    const m = assistant('**Bold**\n\n```ts\nconst a = 1\n```')
    const { container, unmount } = render(<MessageParts message={m} renderers={AI_RICH_RENDERERS} />)
    expect(container.querySelector('strong')?.textContent).toBe('Bold')
    expect(screen.getByText('TypeScript')).toBeInTheDocument() // CodeBlock's language badge
    unmount()
    render(<AiRenderersProvider renderers={{ text: aiMarkdownText(markdownCodeBlock) }}><MessageParts message={m} /></AiRenderersProvider>)
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
  })

})

describe('ToolCard', () => {
  const part: AiToolPart = { type: 'tool', id: 'c1', name: 'calendar.create', state: 'done', args: { title: 'Review' }, result: { ok: true } }
  it('shows arguments and result as indented JSON text by default', () => {
    const { container } = render(<ToolCard part={part} defaultOpen />)
    expect(screen.getByText('Done')).toBeInTheDocument() // the "Done" badge
    expect(screen.getByText('Arguments')).toBeInTheDocument()
    const pres = container.querySelectorAll('pre')
    expect(pres).toHaveLength(2)
    expect(pres[0].textContent).toBe('{\n  "title": "Review"\n}')
  })
  it('takes a renderValue', () => {
    render(<ToolCard part={part} defaultOpen renderValue={v => <output>{Object.keys(v as object).join(',')}</output>} />)
    expect(screen.getByText('title')).toBeInTheDocument()
  })
})

describe('Markdown', () => {
  it('highlights fences only with renderCode', () => {
    const src = '```ts\nconst a = 1\n```'
    const { unmount } = render(<Markdown>{src}</Markdown>)
    expect(screen.queryByText('TypeScript')).toBeNull()
    expect(screen.getByText('ts')).toBeInTheDocument() // the plain frame's language tag
    unmount()
    render(<Markdown renderCode={markdownCodeBlock}>{src}</Markdown>)
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    render(<Markdown renderCode={markdownCodeBlock}>{'```ruby\nputs 1\n```'}</Markdown>)
    expect(screen.getByText('ruby')).toBeInTheDocument() // unknown language: plain frame
  })
})

describe('Composer pieces', () => {

  it('AgentComposer: advanced settings inline in the model panel (no dialog)', () => {
    render(<AgentComposer onSend={() => 'ok'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model settings' }))
    const panel = screen.getByRole('dialog', { name: 'Model settings' })
    expect(within(panel).getByText('Default model · Assistant')).toBeInTheDocument()
    const adv = within(panel).getByRole('button', { name: 'Advanced settings' })
    expect(adv).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(adv)
    expect(adv).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getByRole('switch', { name: /Web search/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Advanced settings' })).toBeNull()
  })

  it('AgentComposer shows "+ Add connector" only with onAddConnector', () => {
    const cons = [{ name: 'GitHub', desc: 'Repos', color: '#000', on: true }]
    const { unmount } = render(<AgentComposer onSend={() => 'ok'} connectors={cons} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    expect(screen.queryByRole('button', { name: '+ Add connector' })).toBeNull()
    unmount()
    let added = 0
    render(<AgentComposer onSend={() => 'ok'} connectors={cons} onAddConnector={() => { added++ }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add connector' }))
    expect(added).toBe(1)
  })
})
