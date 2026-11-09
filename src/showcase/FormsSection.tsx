import { useMemo, useRef, useState } from 'react'
import { AddressAutocomplete, type AddressRecord, Button, Checkbox, Combobox, DatePicker, DateTimePicker, EmojiInput, Field, Form, FormField, Input, MultiSelect, type Option, PhoneInput, RangeSlider, Rating, SegmentedControl, TagInput, MENTION_COMMANDS, MENTION_PEOPLE, MentionsInput, RTE_SAMPLE, RichTextEditor, Select, SignaturePad, Switch, Textarea, UnsavedChangesBar, sleep, useFormDraft, useToast } from '../lib'
import { Section, Spec } from './kit'

const ROLE_OPTS = ['Admin', 'Editor', 'Viewer'].map(v => ({ value: v, label: v }))
const TZ_OPTS = ['Europe/Zurich', 'Europe/London', 'America/New_York'].map(v => ({ value: v, label: v }))
/** Demo address book for the autocomplete (in an app this is your geocoder's results). */
const FORMS_ADDRESSES: AddressRecord[] = ([
  ['Bahnhofstrasse 21', 'Zürich', '8001', 'Switzerland'], ['Bahnhofplatz 1', 'Bern', '3011', 'Switzerland'], ['Baker Street 221B', 'London', 'NW1 6XE', 'United Kingdom'],
  ['Bankside 90', 'London', 'SE1 9JL', 'United Kingdom'], ['Badenerstrasse 120', 'Zürich', '8004', 'Switzerland'], ['Bergmannstraße 5', 'Berlin', '10961', 'Germany'],
  ['Broadway 1500', 'New York', '10036', 'United States'], ['Bourke Street 330', 'Melbourne', '3000', 'Australia'], ['Victoria Street 12', 'Douglas', 'IM1 2LD', 'Isle of Man'],
  ['Rue de Rivoli 99', 'Paris', '75001', 'France'],
] as const).map(([street, city, postcode, country]) => ({ street, city, postcode, country }))

function ProfileForm() {
  const toast = useToast()
  const f = useFormDraft({ name: 'Alex Lee', email: 'alex@northwind.io', role: 'Admin', tz: 'Europe/Zurich', bio: 'Design engineer. Calm interfaces, fast feedback.', notify: true })
  const [bad, setBad] = useState(false), [shake, setShake] = useState(0), [saving, setSaving] = useState(false)
  const mailRef = useRef<HTMLDivElement>(null)
  const save = async () => {
    if (!/^\S+@\S+\.\S+$/.test(f.values.email)) {
      setBad(true); setShake(s => s + 1)
      mailRef.current?.animate([0, -6, 6, -3, 3, 0].map(x => ({ transform: `translateX(${x}px)` })), { duration: 350 })
      return
    }
    setBad(false); setSaving(true); await sleep(800); setSaving(false); f.commit()
    toast({ title: 'Profile saved', description: 'Changes are live', tone: 'ok' })
  }
  const reset = () => { f.reset(); setBad(false) }
  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] p-4 pb-[68px]">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Display name" htmlFor="sf-name"><Input id="sf-name" value={f.values.name} onChange={e => f.set('name', e.target.value)} /></Field>
        <Field label="Email" htmlFor="sf-mail" error={bad ? 'Check the email address' : undefined}>
          <div ref={mailRef}><Input id="sf-mail" value={f.values.email} invalid={bad} onChange={e => { f.set('email', e.target.value); if (bad && /^\S+@\S+\.\S+$/.test(e.target.value)) setBad(false) }} /></div>
        </Field>
        <Field label="Role" htmlFor="sf-role"><Select id="sf-role" options={ROLE_OPTS} value={f.values.role} onChange={v => f.set('role', v)} /></Field>
        <Field label="Time zone" htmlFor="sf-tz"><Select id="sf-tz" options={TZ_OPTS} value={f.values.tz} onChange={v => f.set('tz', v)} /></Field>
        <Field label="Bio" htmlFor="sf-bio" className="sm:col-span-2"><Textarea id="sf-bio" rows={2} value={f.values.bio} onChange={e => f.set('bio', e.target.value)} /></Field>
      </div>
      <Switch label={<span className="text-[var(--fg2)]">Email notifications</span>} checked={f.values.notify} onChange={v => f.set('notify', v)} />
      <UnsavedChangesBar open={f.dirty || saving} message={bad ? 'Check the email address' : 'Unsaved changes'} onReset={reset} onSave={save} saving={saving} shake={shake} />
    </div>
  )
}

const FS_TEAMS: Option[] = [
  { value: 'design', label: 'Design', group: 'Product' }, { value: 'research', label: 'Research', group: 'Product' }, { value: 'web', label: 'Web platform', group: 'Engineering' },
  { value: 'mobile', label: 'Mobile', group: 'Engineering' }, { value: 'infra', label: 'Infrastructure', group: 'Engineering' }, { value: 'support', label: 'Support', group: 'Operations' },
]
const FS_SKILLS: Option[] = ['React', 'TypeScript', 'Figma', 'SQL', 'Motion'].map(v => ({ value: v.toLowerCase(), label: v }))
const FS_OFFICES: Option[] = ['Zürich', 'London', 'Berlin', 'New York', 'Melbourne', 'Remote'].map(v => ({ value: v.toLowerCase().replace(/ /g, '-'), label: v }))

/** A real <form>: required custom controls, focus on the first error, FormData on submit, reset to defaults. */
function FormSubmissionDemo() {
  const [entries, setEntries] = useState<[string, string][] | null>(null)
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_minmax(220px,0.8fr)]">
      <Form aria-label="Join a team" onValues={data => setEntries([...data.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]))} onReset={() => setEntries(null)}
        className="grid gap-3 sm:grid-cols-2">
        <FormField label="Full name" name="name" required description="As on your contract"><Input autoComplete="name" placeholder="Alex Lee" /></FormField>
        <FormField label="Team" name="team" required description="Grouped by department"><Combobox options={FS_TEAMS} placeholder="Search teams" /></FormField>
        <FormField label="Office" name="office" required description="Where you’ll sit most days"><Combobox options={FS_OFFICES} placeholder="Choose an office" /></FormField>
        <FormField label="Start date" name="start" required description="Sent as 2026-11-08"><DatePicker /></FormField>
        <FormField label="Kick-off" name="kickoff" description="ISO with offset; the zone as kickoff_tz"><DateTimePicker timeZone="Europe/Zurich" timeZoneName="kickoff_tz" /></FormField>
        <FormField label="Skills" name="skills" description="Each one is its own field"><MultiSelect options={FS_SKILLS} defaultValue={['react']} placeholder="Pick skills" /></FormField>
        <FormField label="Mobile" name="phone" description="Sent in E.164"><PhoneInput /></FormField>
        <FormField label="Hours a week" name="hours" description="Low and high, as two fields"><RangeSlider defaultValue={[24, 40]} min={8} max={48} step={4} valueText={v => `${v} hours`} /></FormField>
        <FormField label="Contract" name="contract" description="Full time unless you say otherwise"><SegmentedControl options={['Full time', 'Part time', 'Contractor']} defaultValue="Full time" size="sm" className="self-start" /></FormField>
        <FormField label="Tags" name="tags" description="Enter adds a tag"><TagInput placeholder="Add a tag" /></FormField>
        <FormField label="How was onboarding?" name="rating" description="Optional; sent as 1–5"><Rating prompt="Tap to rate" /></FormField>
        <FormField name="terms" required className="sm:col-span-2" description="Required to submit"><Checkbox value="accepted">I accept the team handbook</Checkbox></FormField>
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" variant="primary">Submit</Button><Button type="reset">Reset</Button></div>
      </Form>
      <div className="flex min-h-[220px] flex-col rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--bg)] p-3">
        <span className="mb-2 text-[11px] font-medium tracking-wide text-[var(--fg3)] uppercase">FormData</span>
        <div role="status" aria-live="polite" className="max-h-[360px] min-h-0 flex-1 overflow-auto font-[family-name:var(--mono)] text-xs leading-relaxed">
          {entries ? entries.map(([k, v], i) => <div key={i} className="flex gap-2"><span className="text-[var(--fg3)]">{k}</span><span className="break-all">{v || '""'}</span></div>)
            : <span className="font-[family-name:var(--font)] text-[var(--fg3)]">Submit with empty fields to see focus jump to the first error, then fill them in.</span>}
        </div>
      </div>
    </div>
  )
}

const FS_CITIES = ['Amsterdam', 'Athens', 'Auckland', 'Austin', 'Bangkok', 'Barcelona', 'Basel', 'Berlin', 'Bern', 'Bogotá', 'Boston', 'Brussels', 'Budapest', 'Buenos Aires', 'Cairo', 'Cape Town', 'Chicago', 'Copenhagen', 'Dublin', 'Edinburgh', 'Geneva', 'Hamburg', 'Helsinki', 'Hong Kong', 'Istanbul', 'Lisbon', 'London', 'Los Angeles', 'Lyon', 'Madrid', 'Melbourne', 'Mexico City', 'Milan', 'Montréal', 'Mumbai', 'Munich', 'Nairobi', 'New York', 'Oslo', 'Paris', 'Prague', 'Reykjavík', 'Rome', 'San Francisco', 'São Paulo', 'Seoul', 'Singapore', 'Stockholm', 'Sydney', 'Tokyo', 'Toronto', 'Vancouver', 'Vienna', 'Warsaw', 'Zürich']
const FS_SKUS: Option[] = Array.from({ length: 10_000 }, (_, i) => {
  const kinds = ['Desk lamp', 'Notebook', 'Monitor arm', 'Keyboard', 'Headphones', 'Chair mat', 'Cable tray', 'Webcam']
  return { value: `sku-${10001 + i}`, label: `${kinds[i % kinds.length]} · SKU ${10001 + i}` }
})

/** Async combobox against a fake API (latency, abort, error with retry, create) and a 10,000-option virtualised list. */
function AsyncComboDemo() {
  const [fail, setFail] = useState(false), [calls, setCalls] = useState({ sent: 0, aborted: 0 })
  const failRef = useRef(fail); failRef.current = fail
  const load = useMemo(() => (q: string, { signal }: { signal: AbortSignal }) => new Promise<Option[]>((resolve, reject) => {
    setCalls(c => ({ ...c, sent: c.sent + 1 }))
    const t = setTimeout(() => {
      if (failRef.current) return reject(new Error('Network error'))
      resolve(FS_CITIES.filter(c => c.toLowerCase().includes(q.toLowerCase())).map(c => ({ value: c.toLowerCase().replace(/\W+/g, '-'), label: c, group: c[0] })))
    }, 450 + Math.random() * 400)
    signal.addEventListener('abort', () => { clearTimeout(t); setCalls(c => ({ ...c, aborted: c.aborted + 1 })); reject(signal.reason) })
  }), [])
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-3">
      <FormField label="City" description="Fake API, 450–850 ms. Type fast: stale requests are aborted.">
        <Combobox loadOptions={load} minChars={1} creatable placeholder="Search cities" />
      </FormField>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Switch label={<span className="text-xs text-[var(--fg2)]">Fail requests</span>} checked={fail} onChange={setFail} />
        <span className="ui-num text-xs text-[var(--fg3)]">{calls.sent} sent · {calls.aborted} aborted</span>
      </div>
      </div>
      <FormField label="Product" description="10,000 options, only the visible rows are rendered">
        <Combobox options={FS_SKUS} placeholder="Search 10,000 products" />
      </FormField>
    </div>
  )
}

const FS_PEOPLE: Option[] = [
  ['Ada Lovelace', 'Engineering'], ['Alan Turing', 'Engineering'], ['Grace Hopper', 'Engineering'], ['Linus Torvalds', 'Engineering'], ['Margaret Hamilton', 'Engineering'],
  ['Dieter Rams', 'Design'], ['Susan Kare', 'Design'], ['Paula Scher', 'Design'], ['Massimo Vignelli', 'Design'],
  ['Katherine Johnson', 'Research'], ['Marie Curie', 'Research'], ['Rosalind Franklin', 'Research'], ['Richard Feynman', 'Research'],
  ['Mary Barra', 'Operations'], ['Satya Nadella', 'Operations'], ['Indra Nooyi', 'Operations'],
].map(([name, group]) => ({ value: name.toLowerCase().replace(/\W+/g, '-'), label: name, group }))

/** MultiSelect with loadOptions against a fake people API: debounce, abort, loading/error/retry, create, groups. */
function AsyncMultiDemo() {
  const [fail, setFail] = useState(false), [picked, setPicked] = useState<string[]>(['grace-hopper', 'dieter-rams'])
  const failRef = useRef(fail); failRef.current = fail
  const load = useMemo(() => (q: string, { signal }: { signal: AbortSignal }) => new Promise<Option[]>((resolve, reject) => {
    const t = setTimeout(() => failRef.current ? reject(new Error('Network error')) : resolve(FS_PEOPLE.filter(p => p.label.toLowerCase().includes(q.toLowerCase()))), 350 + Math.random() * 350)
    signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason) })
  }), [])
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_minmax(200px,0.6fr)]">
      <div className="flex flex-col gap-3">
        <FormField label="Reviewers" description="Fake API, 350–700 ms, grouped by team. Type a name, or create someone new.">
          <MultiSelect loadOptions={load} defaultOptions={FS_PEOPLE.slice(0, 6)} creatable value={picked} onChange={setPicked} placeholder="Search people" />
        </FormField>
        <Switch label={<span className="text-xs text-[var(--fg2)]">Fail requests</span>} checked={fail} onChange={setFail} />
      </div>
      <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--bg)] p-3">
        <span className="mb-2 block text-[11px] font-medium tracking-wide text-[var(--fg3)] uppercase">Value</span>
        <div role="status" aria-live="polite" className="font-[family-name:var(--mono)] text-xs leading-relaxed break-all">{picked.length ? JSON.stringify(picked) : '[]'}</div>
      </div>
    </div>
  )
}

function SignatureDemo() {
  const toast = useToast()
  return <SignaturePad onConfirm={(_, n) => toast({ title: 'Signature captured', description: `${n} stroke${n === 1 ? '' : 's'}`, tone: 'ok' })} />
}

export function FormsSection() {
  return (
    <Section id="forms" title="Forms" desc="Editors and smart inputs: rich text, mentions, signatures, addresses, emoji, and a form that knows when it has unsaved changes.">
      <Spec title="Rich text editor" desc="Toolbar plus a floating bubble on selection. Type “# ” for a heading, “- ” for a list." span={2}
        keys={[[['⌘', 'B'], 'Bold'], [['⌘', 'I'], 'Italic'], [['⌘', 'U'], 'Underline']]}>
        <RichTextEditor defaultValue={RTE_SAMPLE} />
      </Spec>
      <Spec title="Signature pad" desc="Smooth, pressure-like strokes. Undo stroke by stroke."><SignatureDemo /></Spec>
      <Spec title="Mentions and commands" desc="Type @ to mention someone, / for a command"><MentionsInput people={MENTION_PEOPLE} commands={MENTION_COMMANDS} /></Spec>
      <Spec title="Address autocomplete" desc="Type a street; picking a result fills the rest"><AddressAutocomplete addresses={FORMS_ADDRESSES} /></Spec>
      <Spec title="Emoji picker" desc="Categories, search, recently used"><EmojiInput /></Spec>
      <Spec title="Form submission" desc="A real form: custom controls submit like native fields. Required fields stop the submit and focus the first error; Reset restores the defaults." span={3}><FormSubmissionDemo /></Spec>
      <Spec title="Async combobox" desc="Debounced loader with abort, loading and error states, retry, create, groups; plus a virtualised 10,000-option list" span={3}><AsyncComboDemo /></Spec>
      <Spec title="Async multi-select" desc="loadOptions like the async combobox: debounced, aborted when superseded, loading, error with retry, groups, create. Picks stay labelled across searches" span={3}><AsyncMultiDemo /></Spec>
      <Spec title="Form with unsaved changes" desc="Edit anything and a save bar slides up. Reset restores, Save validates first." span={3}><ProfileForm /></Spec>
    </Section>
  )
}
