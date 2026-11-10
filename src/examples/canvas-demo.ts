import type { CanvasContext, CanvasReply } from '../lib/aiagent'
import { AI_CANVAS_SAMPLE } from './canvas'

/* Showcase-only stand-in for AICanvas's model: scripted edits and a canned explainer behind the real `respond`. */

/** One scripted edit: the prompt it answers, the reply, and the whole new document. */
export type CanvasEdit = { prompt: string; reply: string; code: string }

/**
 * A pretend model for AICanvas's `respond`: after `latency` ms, a prompt matching a scripted edit's (or a suggestion
 * chip) applies that edit; a question about a line goes to `explain`; anything else gets a note that the demo only
 * knows its scripted edits.
 */
export function scriptedCanvasRespond(edits: readonly CanvasEdit[], { explain, latency = 700 }: { explain?: (line: number, text: string) => string; latency?: number } = {}) {
  return async (prompt: string, _code: string, ctx: CanvasContext): Promise<CanvasReply> => {
    await new Promise(r => setTimeout(r, latency))
    if (ctx.line != null) return explain ? explain(ctx.line, ctx.lineText ?? '') : `Line ${ctx.line} is part of the document.`
    const e = edits.find(x => x.prompt.toLowerCase() === prompt.trim().toLowerCase())
    return e ? { reply: e.reply, code: e.code } : `This demo only knows its scripted edits: ${edits.map(x => `“${x.prompt}”`).join(', ')}.`
  }
}

/** The showcase's AICanvas props: the sample document, its scripted edits as `respond` and as suggestion chips, and the explainer. */
export function canvasDemoProps(sample = AI_CANVAS_SAMPLE) {
  const { edits, explain, ...rest } = sample
  return { ...rest, respond: scriptedCanvasRespond(edits, { explain }), suggestions: edits.map(e => e.prompt) }
}
