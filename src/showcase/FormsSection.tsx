import { useRef, useState } from 'react'
import { AddressAutocomplete, type AddressRecord, EmojiInput, Field, Input, MentionsInput, RichTextEditor, Select, SignaturePad, Switch, Textarea, UnsavedChangesBar, sleep, useFormDraft, useToast } from '../lib'
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

function SignatureDemo() {
  const toast = useToast()
  return <SignaturePad onConfirm={(_, n) => toast({ title: 'Signature captured', description: `${n} stroke${n === 1 ? '' : 's'}`, tone: 'ok' })} />
}

export function FormsSection() {
  return (
    <Section id="forms" title="Forms" desc="Editors and smart inputs: rich text, mentions, signatures, addresses, emoji, and a form that knows when it has unsaved changes.">
      <Spec title="Rich text editor" desc="Toolbar plus a floating bubble on selection. ⌘B, ⌘I, ⌘U work. Type “# ” for a heading, “- ” for a list." span={2}>
        <RichTextEditor />
      </Spec>
      <Spec title="Mentions and commands" desc="Type @ to mention someone, / for a command"><MentionsInput /></Spec>
      <Spec title="Form with unsaved changes" desc="Edit anything and a save bar slides up. Reset restores, Save validates first." span={2}><ProfileForm /></Spec>
      <Spec title="Signature pad" desc="Smooth, pressure-like strokes. Undo stroke by stroke."><SignatureDemo /></Spec>
      <Spec title="Address autocomplete" desc="Type a street; picking a result fills the rest"><AddressAutocomplete addresses={FORMS_ADDRESSES} /></Spec>
      <Spec title="Emoji picker" desc="Categories, search, recently used"><EmojiInput /></Spec>
    </Section>
  )
}
