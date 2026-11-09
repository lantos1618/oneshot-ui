// AI components: translated strings (de/ar), direction (bubbles, code stays LTR, dir="auto" text) and the injectable
// renderers that keep the chat drop-ins small (plain text / JSON by default, Markdown + CodeBlock + JsonViewer on request).
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { LocaleProvider } from '../../src/lib/core'
import { AI_RICH_RENDERERS, AgentComposer, AiRenderersProvider, Message, MessageParts, ToolCard, aiMarkdownText } from '../../src/lib/aichat'
import { PromptInput, SendButton } from '../../src/lib/ai'
import { Markdown } from '../../src/lib/markdown'
import { CodeBlock, markdownCodeBlock } from '../../src/lib/code'
import { applyAiChunk, type AiMessage, type AiToolPart } from '../../src/lib/aistream'

const ar = (ui: ReactNode) => render(<LocaleProvider locale="ar-EG">{ui}</LocaleProvider>)
const de = (ui: ReactNode) => render(<LocaleProvider locale="de-DE">{ui}</LocaleProvider>)
const assistant = (text: string, extra: AiMessage['parts'] = []): AiMessage => ({ id: 'a', role: 'assistant', status: 'done', parts: [...extra, { type: 'text', text }] })

describe('MessageParts renderers', () => {
  it('renders text as Markdown by default: [n] as a citation, each paragraph dir="auto", fences in the plain frame', () => {
    const m = assistant('**Bold** claim [1]\n\nمرحبا بالعالم\n\n```ts\nconst a = 1\n```', [{ type: 'source', url: 'https://example.com/a', title: 'Source A' }])
    const { container } = render(<MessageParts message={m} />)
    expect(container.querySelector('strong')?.textContent).toBe('Bold')
    expect(screen.queryByText('TypeScript')).toBeNull() // no highlighter by default
    expect(container.querySelector('pre[dir="ltr"]')?.textContent).toBe('const a = 1')
    expect(screen.getByRole('button', { name: 'Source 1: Source A' })).toBeInTheDocument()
    const ps = container.querySelectorAll('p[dir="auto"]')
    expect(ps).toHaveLength(2)
    expect(ps[1].textContent).toBe('مرحبا بالعالم')
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

  it('shows an empty error part as a translated "something went wrong"', () => {
    const msgs = applyAiChunk([], { type: 'error' } as never)
    const m = msgs[msgs.length - 1]
    expect(m.parts.find(p => p.type === 'error')).toEqual({ type: 'error', message: '' })
    de(<MessageParts message={m} onRetry={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Etwas ist schiefgelaufen')
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
  })
})

describe('ToolCard', () => {
  const part: AiToolPart = { type: 'tool', id: 'c1', name: 'calendar.create', state: 'done', args: { title: 'Review' }, result: { ok: true } }
  it('shows arguments and result as indented JSON text by default, left to right', () => {
    const { container } = ar(<ToolCard part={part} defaultOpen />)
    expect(screen.getByText('تم')).toBeInTheDocument() // the "Done" badge
    expect(screen.getByText('المعطيات')).toBeInTheDocument()
    const pres = container.querySelectorAll('pre[dir="ltr"]')
    expect(pres).toHaveLength(2)
    expect(pres[0].textContent).toBe('{\n  "title": "Review"\n}')
  })
  it('takes a renderValue', () => {
    render(<ToolCard part={part} defaultOpen renderValue={v => <output>{Object.keys(v as object).join(',')}</output>} />)
    expect(screen.getByText('title')).toBeInTheDocument()
  })
  it('asks for approval in Arabic', () => {
    ar(<ToolCard part={{ ...part, state: 'awaiting-approval', result: undefined }} onDecide={() => {}} />)
    expect(screen.getByRole('group', { name: 'بحاجة إلى موافقة' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'موافقة' })).toBeInTheDocument()
  })
})

describe('Message in RTL', () => {
  it('puts the person on the inline end with a dir="auto" bubble and translates the assistant name', () => {
    const user: AiMessage = { id: 'u', role: 'user', status: 'done', parts: [{ type: 'text', text: 'Hello مرحبا' }] }
    const { container } = ar(<><Message message={user} /><Message message={assistant('Hi')} /></>)
    const bubble = screen.getByText('Hello مرحبا')
    expect(bubble).toHaveAttribute('dir', 'auto')
    expect(bubble.className).toContain('rounded-ee-[4px]') // the tail follows the inline end
    expect(bubble.parentElement!.className).toContain('self-end')
    expect(container).toHaveTextContent('المساعد')
  })
})

describe('Markdown', () => {
  it('gives each block dir="auto" and keeps fenced code left to right', () => {
    const { container } = render(<Markdown>{'# عنوان\n\nEnglish paragraph\n\n- one\n- two\n\n> quote\n\n```\nplain()\n```'}</Markdown>)
    expect(container.querySelector('h1')).toHaveAttribute('dir', 'auto')
    expect(container.querySelector('p')).toHaveAttribute('dir', 'auto')
    expect(container.querySelector('ul')).toHaveAttribute('dir', 'auto')
    expect(container.querySelector('blockquote')).toHaveAttribute('dir', 'auto')
    expect(container.querySelector('pre')).toHaveAttribute('dir', 'ltr')
  })
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
  it('translates its labels', () => {
    ar(<Markdown>{'- [x] shipped\n- [ ] docs'}</Markdown>)
    expect(screen.getByText(/منجز:/)).toBeInTheDocument()
    expect(screen.getByText(/للإنجاز:/)).toBeInTheDocument()
  })
})

describe('Code', () => {
  it('keeps code rows LTR and translates the header in German', () => {
    const { container } = de(<CodeBlock code={'const a = 1'} language="ts" />)
    expect(container.querySelector('pre')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByRole('button', { name: /Umbruch|Zeilen umbrechen/ })).toBeInTheDocument()
    expect(screen.getByText('Ausschnitt')).toBeInTheDocument()
  })
})

describe('Composer pieces', () => {
  it('SendButton and PromptInput speak Arabic; the model picker is a native select', () => {
    ar(<><SendButton /><PromptInput onSubmit={() => {}} models={[{ value: 'a', label: 'Fast' }, { value: 'b', label: 'Deep' }]} model="b" /></>)
    expect(screen.getAllByRole('button', { name: 'إرسال' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('textbox', { name: 'الرسالة' })).toHaveAttribute('placeholder', 'اسأل عن أي شيء…')
    const select = screen.getByRole('combobox', { name: 'النموذج' }) as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect(select.value).toBe('b')
  })

  it('AgentComposer: translated defaults, advanced settings inline in the model panel (no dialog)', () => {
    de(<AgentComposer onSend={() => 'ok'} />)
    expect(screen.getByRole('heading', { name: 'Woran arbeiten wir?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Modelleinstellungen' }))
    const panel = screen.getByRole('dialog', { name: 'Modelleinstellungen' })
    expect(within(panel).getByText('Standardmodell · Assistent')).toBeInTheDocument()
    const adv = within(panel).getByRole('button', { name: 'Erweiterte Einstellungen' })
    expect(adv).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(adv)
    expect(adv).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getByRole('switch', { name: /Websuche/ })).toBeInTheDocument()
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
