import type { CanvasEdit } from '../lib/aiagent'

/* Sample AICanvas content: a themed pricing card, three scripted edits and an explainer. */

/** The demo document: a pricing card that uses the host theme tokens, so it follows light/dark and every theme. */
function aiPricingCard(btnRadius: string | null, toggle: boolean, dark: boolean) {
  return `<style>
  /* uses the host theme tokens, so it follows Light / Dark / System and every theme */
  .card { width: 280px; padding: 24px; border-radius: var(--r-lg, 14px); font-family: var(--font);
    background: ${dark ? 'var(--primary)' : 'var(--card)'}; color: ${dark ? 'var(--on-primary)' : 'var(--fg)'};
    border: 1px solid ${dark ? 'transparent' : 'var(--line)'}; box-shadow: var(--shadow); }
  .price { font-size: 40px; font-weight: 700; letter-spacing: -.02em; margin: 8px 0; }
  .muted { color: ${dark ? 'color-mix(in srgb, var(--on-primary) 65%, transparent)' : 'var(--fg3)'}; font-size: 14px; }
  ul { padding-left: 18px; line-height: 1.9; font-size: 14px; }
  .cta { width: 100%; padding: ${btnRadius ? '12px' : '10px'}; border: 0; border-radius: ${btnRadius || 'var(--r-md, 8px)'}; font: 600 14px var(--font);
    background: var(--accent); color: var(--on-primary); }${toggle ? `
  .toggle { display: flex; gap: 4px; padding: 4px; border-radius: 999px; margin-bottom: 16px; font-size: 13px;
    background: ${dark ? 'color-mix(in srgb, var(--on-primary) 12%, transparent)' : 'var(--muted)'}; }
  .toggle label { flex: 1; text-align: center; padding: 4px; border-radius: 999px; cursor: pointer; }
  #yr:checked ~ .toggle .y, #mo:checked ~ .toggle .m { background: ${dark ? 'color-mix(in srgb, var(--on-primary) 22%, transparent)' : 'var(--card)'}; }
  #yr:checked ~ .p-mo, #mo:checked ~ .p-yr { display: none; }
  input[name="b"] { display: none; }` : ''}
</style><div class="card">${toggle ? `
  <input type="radio" name="b" id="mo" checked><input type="radio" name="b" id="yr">
  <div class="toggle"><label for="mo" class="m">Monthly</label><label for="yr" class="y">Yearly −20%</label></div>` : ''}
  <div class="muted">Pro plan</div>${toggle ? `
  <div class="price p-mo">$24<span class="muted">/mo</span></div>
  <div class="price p-yr">$19<span class="muted">/mo, billed yearly</span></div>` : `
  <div class="price">$24<span class="muted">/mo</span></div>`}
  <ul><li>Unlimited projects</li><li>Priority support</li><li>Version history</li></ul>
  <button class="cta">Start free trial</button>
</div>`
}
const AI_CANVAS_DEMO_EDITS: CanvasEdit[] = [
  { prompt: 'Make the button rounder', reply: 'Rounded the button into a pill and gave it a bit more padding so it reads as the main action.', code: aiPricingCard('999px', false, false) },
  { prompt: 'Add a monthly / yearly toggle', reply: 'Added a segmented toggle. It is pure CSS, so it works without JavaScript, and the yearly price shows the discount.', code: aiPricingCard('999px', true, false) },
  { prompt: 'Make it dark', reply: 'Inverted the card onto the theme’s primary surface. It still uses theme tokens, so it adapts to every theme.', code: aiPricingCard('999px', true, true) },
]
const aiDemoExplain = (n: number, ln: string) => /border-radius/.test(ln) ? 'This sets how round the corners are. 999px makes a full pill; smaller values give softer rectangles.'
  : /:checked/.test(ln) ? 'This highlights whichever toggle option is checked. Hidden radio inputs hold the state, so no JavaScript is needed.'
  : /background/.test(ln) ? 'This sets the fill colour, which changes between the light and dark versions so text keeps enough contrast.'
  : /<button/.test(ln) ? 'This is the call to action. It stretches to the card width so it is easy to hit on mobile.'
  : `Line ${n} is part of the card’s ${/[{}]|:/.test(ln) ? 'styles' : 'markup'}. Ask me to change it and I’ll edit it in place.`
/**
 * The showcase's canvas content: a pricing card, three scripted edits and an explainer. Spread it into the
 * component to get the demo: <AICanvas {...AI_CANVAS_SAMPLE} />. The component itself starts empty.
 */
export const AI_CANVAS_SAMPLE = {
  file: 'pricing-card.html', initial: aiPricingCard(null, false, false), edits: AI_CANVAS_DEMO_EDITS, explain: aiDemoExplain,
  intro: 'I made a pricing card in the canvas. Ask me to change it, or tap a line of code to ask about it.',
}
