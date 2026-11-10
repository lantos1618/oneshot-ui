import { useState, type ReactNode } from 'react'
import { AnimatedNumber, Calendar, Checkbox, ColorPicker, Combobox, CurrencyInput, DateField, DatePicker, DateRangePicker, type DateRange, DateTimePicker, Field, FileUpload, Input, Label, type Magnet, type MagnetZonePull, MonthPicker, MultiSelect, NumberStepper, OTPInput, type Option, PasswordInput, PhoneInput, RadioGroup, RangeSlider, Rating, SegmentedControl, Select, Slider, Switch, TagInput, Textarea, TimeField, TimePicker, YearPicker, cn, formDate } from '../lib'
import { Row, Section, Spec } from './kit'

const COUNTRIES: Option[] = ([['🇦🇺', 'Australia'], ['🇦🇹', 'Austria'], ['🇧🇪', 'Belgium'], ['🇨🇦', 'Canada'], ['🇩🇰', 'Denmark'], ['🇫🇮', 'Finland'], ['🇫🇷', 'France'], ['🇩🇪', 'Germany'], ['🇮🇪', 'Ireland'], ['🇮🇹', 'Italy'], ['🇯🇵', 'Japan'], ['🇳🇱', 'Netherlands'], ['🇳🇿', 'New Zealand'], ['🇳🇴', 'Norway'], ['🇵🇹', 'Portugal'], ['🇸🇬', 'Singapore'], ['🇪🇸', 'Spain'], ['🇸🇪', 'Sweden'], ['🇨🇭', 'Switzerland'], ['🇬🇧', 'United Kingdom'], ['🇺🇸', 'United States']] as const)
  .map(([flag, name]) => ({ value: name.toLowerCase().replace(/ /g, '-'), label: name, leading: flag }))
const LABELS: Option[] = [
  { value: 'bug', label: 'Bug', dot: 'var(--bad)' }, { value: 'feature', label: 'Feature', dot: 'var(--accent)' }, { value: 'design', label: 'Design', dot: 'var(--c3)' },
  { value: 'docs', label: 'Docs', dot: 'var(--ok)' }, { value: 'urgent', label: 'Urgent', dot: 'var(--warn)' }, { value: 'research', label: 'Research', dot: 'var(--fg3)' },
]
const PRIORITY: Option[] = [{ value: 'urgent', label: 'Urgent', dot: 'var(--bad)' }, { value: 'high', label: 'High', dot: 'var(--warn)' }, { value: 'medium', label: 'Medium', dot: 'var(--accent)' }, { value: 'low', label: 'Low', dot: 'var(--fg3)' }]
const eur = { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 } as const
const DUE = new Date(2026, 10, 20)
const lastWeek = (): DateRange => { const t = new Date(); const end = new Date(t.getFullYear(), t.getMonth(), t.getDate()); return [new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6), end] }

const IN_PULLS = ['Edges', 'Center', 'Inside'] as const
const IN_PRICE_MARKS = [100, 250, 500, 750, 1000]
/** Volume with a detent at 100% (above it is boost), points every 25 and a recommended zone whose pull you can switch; a price filter with common price points. */
function InMagnets() {
  const [pull, setPull] = useState<(typeof IN_PULLS)[number]>('Edges')
  const [snap, setSnap] = useState<string>('')
  const volume: Magnet[] = [0, 25, 50, 75, { value: 100, label: '100%, no boost', strength: 1.5 }, { from: 40, to: 60, label: 'Recommended 40–60%', pull: pull.toLowerCase() as MagnetZonePull }]
  return (
    <>
      <Slider label="Volume" defaultValue={30} max={150} magnets={volume} valueText={v => `${v}%`} onSnap={h => setSnap(h ? h.label ?? `${h.value}%` : '')}
        format={v => <AnimatedNumber value={v / 100} format={{ style: 'percent' }} />} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--fg3)]">
        <SegmentedControl aria-label="Zone pull" size="sm" options={[...IN_PULLS]} value={pull} onChange={x => setPull(x as typeof pull)} />
        <span className="ui-num min-h-4" aria-hidden>{snap ? `On ${snap}` : 'Free'}</span>
      </div>
      <RangeSlider label="Price" name="price" defaultValue={[240, 760]} min={0} max={1000} step={10} minGap={50} magnets={IN_PRICE_MARKS}
        format={v => <AnimatedNumber value={v} format={eur} />} valueText={v => `€${v}`} />
    </>
  )
}
/** A compact row of the same control in its other states, under the live demo. */
function InStates({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-auto flex flex-col gap-2 border-t border-dashed border-[var(--line)] pt-3', className)}>
      <span className="text-[11px] font-medium tracking-wide text-[var(--fg3)] uppercase">States</span>
      {children}
    </div>
  )
}
/** A grid of labelled states that wraps on narrow cards. */
const InGrid = ({ children, min = 120 }: { children: ReactNode; min?: number }) => (
  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(min(${min}px,100%),1fr))` }}>{children}</div>
)
/** One labelled state in a States row. */
const InState = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1"><span className="text-[11px] text-[var(--fg3)]">{label}</span>{children}</div>
)

const IN_MIN = new Date(2026, 10, 9), IN_MAX = new Date(2027, 1, 26)
const inWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6

/** An inline calendar with bounds and unavailable weekends, plus a DatePicker with the same rules. */
function ConstraintsDemo() {
  const [day, setDay] = useState<Date | null>(new Date(2026, 10, 12))
  return (
    <div className="flex flex-col gap-3">
      <Calendar selected={day} onSelect={setDay} month={new Date(2026, 10, 1)} min={IN_MIN} max={IN_MAX} isDateUnavailable={inWeekend} className="self-center" />
      <span aria-live="polite" className="text-xs text-[var(--fg3)]">{day ? `Delivery on ${day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}` : 'Pick a weekday'} · 9 Nov 2026 to 26 Feb 2027</span>
      <Field label="Delivery (same rules)" htmlFor="in-delivery"><DatePicker id="in-delivery" min={IN_MIN} max={IN_MAX} isDateUnavailable={inWeekend} defaultValue={new Date(2026, 10, 16)} /></Field>
    </div>
  )
}

/** DateField, TimeField and a Calendar: type segment by segment, switch the clock between 24 and 12 hours. */
function TypedDatesDemo() {
  const [clock, setClock] = useState('24-hour')
  const [date, setDate] = useState<Date | null>(new Date(2026, 10, 8))
  const [time, setTime] = useState('21:05')
  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl aria-label="Clock" size="sm" options={['24-hour', '12-hour']} value={clock} onChange={setClock} className="self-start" />
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          <Field label="Date" htmlFor="in-loc-date"><DateField id="in-loc-date" value={date} onChange={setDate} /></Field>
          <Field label="Time" htmlFor="in-loc-time"><TimeField id="in-loc-time" value={time} onChange={setTime} hourCycle={clock === '12-hour' ? 12 : 24} /></Field>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-[var(--fg3)]">Value</dt><dd className="m-0 font-[family-name:var(--mono)]">{formDate(date) || '""'} {time || '""'}</dd>
            <dt className="text-[var(--fg3)]">Week starts</dt><dd className="m-0">Monday</dd>
            <dt className="text-[var(--fg3)]">Clock</dt><dd className="m-0">{clock}</dd>
          </dl>
        </div>
        <Calendar selected={date} onSelect={setDate} month={date ?? undefined} className="justify-self-center" />
      </div>
    </div>
  )
}

/** DateTimePicker with a zone picker; shows the emitted ISO value and the same instant elsewhere. */
function ZonedDemo() {
  const [iso, setIso] = useState<string | null>('2026-11-12T09:30:00+01:00')
  const [zone, setZone] = useState('Europe/Zurich')
  const at = iso ? new Date(iso) : null
  const elsewhere = (tz: string) => at ? at.toLocaleString('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : '–'
  return (
    <div className="flex flex-col gap-3">
      <Field label="Kick-off call" htmlFor="in-kickoff"><DateTimePicker id="in-kickoff" value={iso} onChange={setIso} timeZone={zone} onTimeZoneChange={setZone} timeZonePicker /></Field>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-[var(--fg3)]">Value</dt><dd className="m-0 font-[family-name:var(--mono)] break-all">{iso ?? 'null'}</dd>
        <dt className="text-[var(--fg3)]">London</dt><dd className="m-0">{elsewhere('Europe/London')}</dd>
        <dt className="text-[var(--fg3)]">New York</dt><dd className="m-0">{elsewhere('America/New_York')}</dd>
        <dt className="text-[var(--fg3)]">Tokyo</dt><dd className="m-0">{elsewhere('Asia/Tokyo')}</dd>
      </dl>
    </div>
  )
}

export function InputsSection() {
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const emailOk = /^\S+@\S+\.\S+$/.test(email)
  const [otp, setOtp] = useState<'ok' | 'bad' | undefined>()
  const [range] = useState(lastWeek)
  return (
    <Section id="inputs" title="Inputs" desc="Every control gives physical feedback: springs for toggles, drawn checkmarks, rolling numbers.">
      <Spec title="Text field with validation" desc="Shakes once on error, validates on blur" span={2}>
        <Field label="Email" htmlFor="in-email" error={touched && email && !emailOk ? 'Add an @ and a domain, like you@example.com' : undefined}
          success={touched && emailOk ? 'Looks good' : undefined} hint="We’ll never share it.">
          <Input id="in-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onBlur={() => setTouched(true)} invalid={touched && !!email && !emailOk} />
        </Field>
        <InStates>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(96px,1fr))]">
            <InState label="Focus"><Input aria-label="Focus state example" defaultValue="alex@north" className="!border-[var(--fg3)] !shadow-[0_0_0_3px_var(--muted)]" /></InState>
            <InState label="Error"><Input aria-label="Error state example" defaultValue="alex@" aria-invalid className="!shadow-none" /><span className="text-[11px] text-[var(--bad)]">Add a domain</span></InState>
            <InState label="Disabled"><Input aria-label="Disabled state example" defaultValue="alex@northwind.io" disabled /></InState>
            <InState label="Read-only"><Input aria-label="Read-only state example" defaultValue="alex@northwind.io" readOnly className="!bg-[var(--muted)]" /></InState>
            <InState label="Small"><Input aria-label="Small size example" placeholder="Search" className="!h-[30px] !text-xs" /></InState>
            <InState label="Large"><Input aria-label="Large size example" placeholder="Search" className="!h-10 !text-sm" /></InState>
          </div>
        </InStates>
      </Spec>
      <Spec title="Switch" desc="Knob stretches as it moves">
        <Switch label={<span className="text-[var(--fg2)]">Notifications</span>} defaultChecked />
        <Switch label={<span className="text-[var(--fg2)]">Auto-save</span>} />
        <InStates><Row className="gap-x-5"><Switch label={<span className="text-[var(--fg3)]">Disabled</span>} disabled /><Switch label={<span className="text-[var(--fg3)]">Disabled on</span>} disabled defaultChecked />
          <Switch label={<span className="text-[var(--fg2)]">Read-only</span>} readOnly defaultChecked /><Switch label={<span className="text-[var(--fg2)]">Invalid</span>} invalid /></Row></InStates>
      </Spec>
      <Spec title="Checkbox and radio" desc="Tick draws itself">
        <Checkbox defaultChecked>Email updates</Checkbox><Checkbox>Weekly digest</Checkbox>
        <RadioGroup label="Plan" className="!flex-row !gap-4" options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
        <InStates><Row className="gap-x-5"><Checkbox disabled>Disabled</Checkbox><Checkbox disabled defaultChecked>Disabled on</Checkbox><Checkbox invalid>Invalid</Checkbox><Checkbox readOnly defaultChecked>Read-only</Checkbox></Row>
          <RadioGroup label="Plan (disabled)" disabled className="!flex-row !gap-4" options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} /></InStates>
      </Spec>
      <Spec title="One-time code" desc="Auto-advance, paste support. Try 123456">
        <OTPInput status={otp} onChange={c => { if (c.length < 6) setOtp(undefined) }} onComplete={c => setOtp(c === '123456' ? 'ok' : 'bad')} />
        <span aria-live="polite" className={cn('text-xs', otp === 'ok' ? 'text-[var(--ok)]' : otp === 'bad' ? 'text-[var(--bad)]' : 'text-[var(--fg3)]')}>
          {otp === 'ok' ? 'Verified' : otp === 'bad' ? 'That code didn’t match. Try 123456.' : 'Enter the 6-digit code'}
        </span>
        <InStates><InGrid min={200}><InState label="Disabled"><OTPInput aria-label="Disabled code" length={4} defaultValue="12" disabled /></InState><InState label="Invalid"><OTPInput aria-label="Invalid code" length={4} defaultValue="1234" invalid /></InState></InGrid></InStates>
      </Spec>
      <Spec title="Segmented control" desc="Pill slides with a spring">
        <SegmentedControl aria-label="View" options={['List', 'Board', 'Calendar']} defaultValue="Board" className="self-start" />
        <InStates><InGrid min={150}><InState label="Small"><SegmentedControl aria-label="Period" size="sm" options={['Day', 'Week', 'Month']} defaultValue="Week" className="self-start" /></InState>
          <InState label="Disabled"><SegmentedControl aria-label="Period (disabled)" size="sm" options={['Day', 'Week', 'Month']} defaultValue="Week" disabled className="self-start" /></InState></InGrid></InStates>
      </Spec>
      <Spec title="Number stepper" desc="Digits roll, never jump">
        <Row><NumberStepper defaultValue={3} min={0} max={99} label="Seats" /><span className="text-xs text-[var(--fg3)]">Seats</span></Row>
        <InStates><Row><NumberStepper defaultValue={10} min={0} max={10} label="Seats at the limit" /><span className="text-xs text-[var(--fg3)]">At the maximum (10)</span></Row>
          <InGrid min={130}><InState label="Disabled"><NumberStepper defaultValue={2} label="Seats (disabled)" disabled /></InState><InState label="Read-only"><NumberStepper defaultValue={4} label="Seats (read-only)" readOnly /></InState></InGrid></InStates>
      </Spec>
      <Spec title="Slider" desc="Live value readout">
        <Slider label="Volume" defaultValue={62} format={v => <AnimatedNumber value={v / 100} format={{ style: 'percent' }} />} />
        <InStates><Slider label="Disabled" defaultValue={30} disabled /><Slider label="Read-only" defaultValue={70} readOnly /></InStates>
      </Spec>
      <Spec title="Slider with magnets" desc="Marks pull the thumb in and hold it a little, like snapping in Figma or the detents on iOS. Flick past them, or hold Alt (⌥) or put a second finger down to drag freely"
        keys={[[['PgUp', 'PgDn'], 'Next, previous mark'], [['←', '→'], 'Step as usual'], [['⌥'], 'Hold while dragging: no snapping']]}
        notes={{ good: 'Values people usually want (defaults, round numbers, a recommended band, the 100% before a boost) while keeping every value reachable.', breaks: 'Marks are closer than a finger’s width or the useful values aren’t known: snapping then just feels sticky. Use steps or a number field.' }}>
        <InMagnets />
      </Spec>
      <Spec title="Rating" desc="Stars pop in sequence"><Rating /><InStates><InGrid min={140}><InState label="With a value"><Rating aria-label="Rating with a value" defaultValue={4} /></InState>
        <InState label="Read-only"><Rating aria-label="Read-only rating" defaultValue={3} readOnly /></InState><InState label="Disabled"><Rating aria-label="Disabled rating" defaultValue={2} disabled /></InState></InGrid></InStates></Spec>
      <Spec title="Tag input" desc="Enter adds, backspace removes"><TagInput defaultValue={['design', 'research']} placeholder="Add tag" />
        <InStates><InGrid min={140}><InState label="Disabled"><TagInput aria-label="Disabled tags" defaultValue={['design']} placeholder="Disabled tags" disabled /></InState>
          <InState label="Read-only"><TagInput defaultValue={['research']} placeholder="Read-only tags" readOnly /></InState><InState label="Invalid"><TagInput placeholder="Add at least one" invalid /></InState></InGrid></InStates></Spec>
      <Spec title="Date picker dropdown" desc="Calendar pops from the field, months slide. Click the month for a month and year grid">
        <Field label="Due date" htmlFor="in-due"><DatePicker id="in-due" /></Field>
        <InStates><InGrid min={150}><Field label="Disabled"><DatePicker disabled defaultValue={DUE} /></Field><Field label="Read-only"><DatePicker readOnly defaultValue={DUE} /></Field>
          <Field label="Invalid" error="Pick a weekday"><DatePicker /></Field></InGrid></InStates>
      </Spec>
      <Spec title="Calendar constraints" desc="min and max, weekends unavailable (struck through, still focusable and announced), today marked" keys={[[['←', '↑', '↓', '→'], 'Day, week'], [['PgUp', 'PgDn'], 'Month'], [['⇧', 'PgUp'], 'Year'], [['Home', 'End'], 'Week start, end']]}>
        <ConstraintsDemo />
      </Spec>
      <Spec title="Date range picker" desc="Presets, two months side by side (stacked on phones), drag either end">
        <Field label="Period" htmlFor="in-period"><DateRangePicker id="in-period" defaultValue={range} numberOfMonths={2} /></Field>
        <InStates><InGrid min={150}><Field label="Disabled"><DateRangePicker disabled defaultValue={range} /></Field><Field label="Invalid" error="Choose an end date"><DateRangePicker defaultValue={[range[0], null]} /></Field></InGrid></InStates>
      </Spec>
      <Spec title="Typed dates" desc="Type a date or time segment by segment, step it with the arrows, or paste an ISO date; 12- or 24-hour clock" span={2}
        keys={[[['0–9'], 'Type, moves on'], [['↑', '↓'], 'Step'], [['←', '→'], 'Segment'], [['⌫'], 'Clear'], [['⌘', 'V'], 'Paste 2026-11-08']]}>
        <TypedDatesDemo />
      </Spec>
      <Spec title="Time picker" desc="Type the time, or pick from 15-minute slots behind the clock">
        <Field label="Start time" htmlFor="in-time"><TimePicker id="in-time" defaultValue="09:30" /></Field>
        <InStates><InGrid min={130}><Field label="12-hour"><TimePicker hourCycle={12} defaultValue="14:15" /></Field><Field label="Disabled"><TimePicker disabled defaultValue="10:00" /></Field>
          <Field label="Read-only"><TimePicker readOnly defaultValue="14:15" /></Field><Field label="Out of hours" error="Choose 08:00 to 18:00"><TimeField min="08:00" max="18:00" defaultValue="19:30" /></Field></InGrid></InStates>
      </Spec>
      <Spec title="Date and time with a time zone" desc="Calendar, time and a searchable zone list. The value is ISO 8601 with the zone’s offset; a new zone keeps the wall time" span={2}>
        <ZonedDemo />
      </Spec>
      <Spec title="Month and year" desc="The calendar’s quick picker on its own">
        <InGrid min={150}><Field label="Billing month" htmlFor="in-month"><MonthPicker id="in-month" defaultValue={new Date(2026, 10, 1)} max={new Date(2027, 11, 31)} /></Field>
          <Field label="Graduation year" htmlFor="in-year"><YearPicker id="in-year" defaultValue={2024} max={new Date(2030, 0, 1)} /></Field></InGrid>
        <InStates><InGrid min={150}><Field label="Disabled"><MonthPicker disabled defaultValue={new Date(2026, 0, 1)} /></Field><Field label="Empty"><YearPicker /></Field></InGrid></InStates>
      </Spec>
      <Spec title="Combobox" desc="Type to filter, match highlighted">
        <Field label="Country" htmlFor="in-country"><Combobox id="in-country" options={COUNTRIES} placeholder="Search countries" empty={q => <>No country matches “{q}”</>} /></Field>
        <InStates><InGrid min={150}><Field label="Disabled"><Combobox options={COUNTRIES} defaultValue="japan" disabled /></Field><Field label="Invalid" error="Choose a country"><Combobox options={COUNTRIES} placeholder="Search countries" /></Field></InGrid></InStates>
      </Spec>
      <Spec title="Multi-select" desc="Checks in the list, chips in the field">
        <div><Label>Labels</Label><MultiSelect aria-label="Labels" options={LABELS} defaultValue={['feature', 'design']} placeholder="Choose labels" /></div>
        <InStates><InGrid min={150}><Field label="Disabled"><MultiSelect options={LABELS} defaultValue={['bug']} disabled /></Field><Field label="Read-only"><MultiSelect options={LABELS} defaultValue={['docs']} readOnly /></Field></InGrid></InStates>
      </Spec>
      <Spec title="Select" desc="The shared dropdown: keyboard, type-ahead that cycles, optional colour dots, flips up near the bottom">
        <Field label="Priority" htmlFor="in-priority"><Select id="in-priority" options={PRIORITY} defaultValue="medium" /></Field>
        <InStates><InGrid min={110}><Field label="Disabled"><Select options={PRIORITY} defaultValue="low" disabled /></Field><Field label="Read-only"><Select options={PRIORITY} defaultValue="high" readOnly /></Field>
          <Field label="Invalid" error="Required"><Select options={PRIORITY} placeholder="Choose" /></Field></InGrid></InStates>
      </Spec>
      <Spec title="Textarea" desc="Grows with content, ring fills to the limit">
        <Field label="Bio" htmlFor="in-bio"><Textarea id="in-bio" rows={2} maxLength={140} placeholder="Tell people about yourself" /></Field>
        <InStates><Row className="!flex-nowrap"><Textarea aria-label="Disabled example" rows={1} disabled defaultValue="Locked by an admin" /><Textarea aria-label="Read-only example" rows={1} readOnly defaultValue="Read-only note" className="!bg-[var(--muted)]" /></Row></InStates>
      </Spec>
      <Spec title="Password" desc="Show and hide, live strength">
        <Field label="Password" htmlFor="in-pw"><PasswordInput id="in-pw" placeholder="At least 8 characters" strength /></Field>
        <InStates><InGrid min={140}><Field label="Disabled"><PasswordInput defaultValue="hunter22" disabled /></Field><Field label="Invalid" error="Too short"><PasswordInput defaultValue="abc" /></Field></InGrid></InStates>
      </Spec>
      <Spec title="Colour picker" desc="Swatches, hue, and hex. The hue snaps to the primary and secondary hues (hold Alt to drag freely)"><ColorPicker hueMagnets /><InStates><Field label="Disabled"><ColorPicker defaultValue="#16A34A" disabled swatches={['#16A34A', '#2563EB']} /></Field></InStates></Spec>
      <Spec title="File upload" desc="Drop or browse, per-file progress" span={2}><FileUpload accept="image/*,.pdf" hint="Images or PDF, up to 20 MB" defaultFiles={[{ name: 'brand-guidelines.pdf', size: 2_400_000 }]} /></Spec>
      <Spec title="Range slider" desc="Two handles, values roll">
        <RangeSlider label="Price" defaultValue={[200, 750]} min={0} max={1000} step={10} minGap={50}
          format={v => <AnimatedNumber value={v} format={eur} />} valueText={v => `€${v}`} />
        <InStates><RangeSlider label="Disabled" defaultValue={[20, 60]} disabled /><RangeSlider label="Read-only" defaultValue={[30, 90]} readOnly /></InStates>
      </Spec>
      <Spec title="Phone number" desc="Country picker, formats as you type">
        <Field label="Mobile" htmlFor="in-phone"><PhoneInput id="in-phone" /></Field>
        <InStates><Field label="Error" htmlFor="in-phone-bad" error="Swiss mobile numbers have 9 digits"><PhoneInput id="in-phone-bad" defaultValue="79 123" invalid /></Field>
          <Field label="Disabled"><PhoneInput defaultValue="79 123 45 67" disabled /></Field></InStates>
      </Spec>
      <Spec title="Currency input" desc="Thousands separators while typing">
        <Field label="Amount" htmlFor="in-amount"><CurrencyInput id="in-amount" /></Field>
        <InStates><Field label="Error" htmlFor="in-amount-bad" error="Above your CHF 10,000 limit"><CurrencyInput id="in-amount-bad" defaultValue={12500} invalid /></Field>
          <Field label="Read-only"><CurrencyInput defaultValue={480} readOnly /></Field></InStates>
      </Spec>
    </Section>
  )
}
