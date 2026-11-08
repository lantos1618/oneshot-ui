import { useState } from 'react'
import { AnimatedNumber, Checkbox, ColorPicker, Combobox, CurrencyInput, DatePicker, DateRangePicker, type DateRange, Field, FileUpload, Input, Label, MultiSelect, NumberStepper, OTPInput, type Option, PasswordInput, PhoneInput, RadioGroup, RangeSlider, Rating, SegmentedControl, Select, Slider, Switch, TagInput, Textarea, TimePicker, cn } from '../lib'
import { Row, Section, Spec } from './kit'

const COUNTRIES: Option[] = ([['🇦🇺', 'Australia'], ['🇦🇹', 'Austria'], ['🇧🇪', 'Belgium'], ['🇨🇦', 'Canada'], ['🇩🇰', 'Denmark'], ['🇫🇮', 'Finland'], ['🇫🇷', 'France'], ['🇩🇪', 'Germany'], ['🇮🇪', 'Ireland'], ['🇮🇹', 'Italy'], ['🇯🇵', 'Japan'], ['🇳🇱', 'Netherlands'], ['🇳🇿', 'New Zealand'], ['🇳🇴', 'Norway'], ['🇵🇹', 'Portugal'], ['🇸🇬', 'Singapore'], ['🇪🇸', 'Spain'], ['🇸🇪', 'Sweden'], ['🇨🇭', 'Switzerland'], ['🇬🇧', 'United Kingdom'], ['🇺🇸', 'United States']] as const)
  .map(([flag, name]) => ({ value: name.toLowerCase().replace(/ /g, '-'), label: name, leading: flag }))
const LABELS: Option[] = [
  { value: 'bug', label: 'Bug', dot: 'var(--bad)' }, { value: 'feature', label: 'Feature', dot: 'var(--accent)' }, { value: 'design', label: 'Design', dot: 'var(--c3)' },
  { value: 'docs', label: 'Docs', dot: 'var(--ok)' }, { value: 'urgent', label: 'Urgent', dot: 'var(--warn)' }, { value: 'research', label: 'Research', dot: 'var(--fg3)' },
]
const PRIORITY: Option[] = [{ value: 'urgent', label: 'Urgent', dot: 'var(--bad)' }, { value: 'high', label: 'High', dot: 'var(--warn)' }, { value: 'medium', label: 'Medium', dot: 'var(--accent)' }, { value: 'low', label: 'Low', dot: 'var(--fg3)' }]
const eur = { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 } as const
const lastWeek = (): DateRange => { const t = new Date(); const end = new Date(t.getFullYear(), t.getMonth(), t.getDate()); return [new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6), end] }

export function InputsSection() {
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const emailOk = /^\S+@\S+\.\S+$/.test(email)
  const [otp, setOtp] = useState<'ok' | 'bad' | undefined>()
  const [range] = useState(lastWeek)
  return (
    <Section id="inputs" title="Inputs" desc="Every control gives physical feedback: springs for toggles, drawn checkmarks, rolling numbers.">
      <Spec title="Switch" desc="Knob stretches as it moves">
        <Switch label={<span className="text-[var(--fg2)]">Notifications</span>} defaultChecked />
        <Switch label={<span className="text-[var(--fg2)]">Auto-save</span>} />
      </Spec>
      <Spec title="Checkbox and radio" desc="Tick draws itself">
        <Checkbox defaultChecked>Email updates</Checkbox><Checkbox>Weekly digest</Checkbox>
        <RadioGroup label="Plan" className="!flex-row !gap-4" options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
      </Spec>
      <Spec title="Text field with validation" desc="Shakes once on error, validates on blur">
        <Field label="Email" htmlFor="in-email" error={touched && email && !emailOk ? 'Add an @ and a domain, like you@example.com' : undefined}
          success={touched && emailOk ? 'Looks good' : undefined} hint="We’ll never share it.">
          <Input id="in-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onBlur={() => setTouched(true)} invalid={touched && !!email && !emailOk} />
        </Field>
      </Spec>
      <Spec title="One-time code" desc="Auto-advance, paste support. Try 123456">
        <OTPInput status={otp} onChange={c => { if (c.length < 6) setOtp(undefined) }} onComplete={c => setOtp(c === '123456' ? 'ok' : 'bad')} />
        <span aria-live="polite" className={cn('text-xs', otp === 'ok' ? 'text-[var(--ok)]' : otp === 'bad' ? 'text-[var(--bad)]' : 'text-[var(--fg3)]')}>
          {otp === 'ok' ? 'Verified' : otp === 'bad' ? 'That code didn’t match. Try 123456.' : 'Enter the 6-digit code'}
        </span>
      </Spec>
      <Spec title="Segmented control" desc="Pill slides with a spring">
        <SegmentedControl options={['List', 'Board', 'Calendar']} defaultValue="Board" className="self-start" />
      </Spec>
      <Spec title="Number stepper" desc="Digits roll, never jump">
        <Row><NumberStepper defaultValue={3} min={0} max={99} label="Seats" /><span className="text-xs text-[var(--fg3)]">Seats</span></Row>
      </Spec>
      <Spec title="Slider" desc="Live value readout">
        <Slider label="Volume" defaultValue={62} format={v => <AnimatedNumber value={v / 100} format={{ style: 'percent' }} />} />
      </Spec>
      <Spec title="Rating" desc="Stars pop in sequence"><Rating /></Spec>
      <Spec title="Tag input" desc="Enter adds, backspace removes"><TagInput defaultValue={['design', 'research']} placeholder="Add tag" /></Spec>
      <Spec title="Date picker dropdown" desc="Calendar pops from the field, months slide">
        <Field label="Due date" htmlFor="in-due"><DatePicker id="in-due" /></Field>
      </Spec>
      <Spec title="Date range picker" desc="Presets plus start to end selection">
        <Field label="Period" htmlFor="in-period"><DateRangePicker id="in-period" defaultValue={range} /></Field>
      </Spec>
      <Spec title="Time picker" desc="15-minute slots, scrolls to selection">
        <Field label="Start time" htmlFor="in-time"><TimePicker id="in-time" defaultValue="09:30" /></Field>
      </Spec>
      <Spec title="Combobox" desc="Type to filter, match highlighted">
        <Field label="Country" htmlFor="in-country"><Combobox id="in-country" options={COUNTRIES} placeholder="Search countries" empty={q => <>No country matches “{q}”</>} /></Field>
      </Spec>
      <Spec title="Multi-select" desc="Checks in the list, chips in the field">
        <div><Label>Labels</Label><MultiSelect aria-label="Labels" options={LABELS} defaultValue={['feature', 'design']} placeholder="Choose labels" /></div>
      </Spec>
      <Spec title="Select" desc="The shared dropdown: keyboard, type-ahead that cycles, optional colour dots, flips up near the bottom">
        <Field label="Priority" htmlFor="in-priority"><Select id="in-priority" options={PRIORITY} defaultValue="medium" /></Field>
      </Spec>
      <Spec title="Textarea" desc="Grows with content, ring fills to the limit">
        <Field label="Bio" htmlFor="in-bio"><Textarea id="in-bio" rows={2} maxLength={140} placeholder="Tell people about yourself" /></Field>
      </Spec>
      <Spec title="Password" desc="Show and hide, live strength">
        <Field label="Password" htmlFor="in-pw"><PasswordInput id="in-pw" placeholder="At least 8 characters" strength /></Field>
      </Spec>
      <Spec title="Colour picker" desc="Swatches, hue, and hex"><ColorPicker /></Spec>
      <Spec title="File upload" desc="Drop or browse, per-file progress"><FileUpload accept="image/*,.pdf" hint="Images or PDF, up to 20 MB" defaultFiles={[{ name: 'brand-guidelines.pdf', size: 2_400_000 }]} /></Spec>
      <Spec title="Range slider" desc="Two handles, values roll">
        <RangeSlider label="Price" defaultValue={[200, 750]} min={0} max={1000} step={10} minGap={50}
          format={v => <AnimatedNumber value={v} format={eur} />} valueText={v => `€${v}`} />
      </Spec>
      <Spec title="Phone number" desc="Country picker, formats as you type">
        <Field label="Mobile" htmlFor="in-phone"><PhoneInput id="in-phone" /></Field>
      </Spec>
      <Spec title="Currency input" desc="Thousands separators while typing">
        <Field label="Amount" htmlFor="in-amount"><CurrencyInput id="in-amount" /></Field>
      </Spec>
    </Section>
  )
}
