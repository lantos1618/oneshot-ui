// Form-native contract of the custom controls (0.3): FormData, required/invalid/disabled, reset, ref focus, FormField
// wiring, the dependency-free Form, the async Combobox and the virtualised option list.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  Checkbox, ColorPicker, Combobox, CurrencyInput, DatePicker, DateRangePicker, Field, FileUpload, Form, FormField, Input, MultiSelect, NumberStepper, OTPInput,
  type Option, PasswordInput, PhoneInput, RadioGroup, RangeSlider, Rating, SegmentedControl, Select, Slider, Switch, TagInput, Textarea, TimePicker,
} from '../../src/lib/forms'
import { fakeTimersUser, inForm, tick } from '../helpers'

const PRIORITY: Option[] = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]
const COUNTRIES: Option[] = [{ value: 'gb', label: 'United Kingdom' }, { value: 'us', label: 'United States' }, { value: 'de', label: 'Germany' }]

describe('FormData from every control', () => {
  it('serialises each control as documented', () => {
    const { data } = inForm(<>
      <Select name="priority" aria-label="Priority" options={PRIORITY} defaultValue="high" />
      <Combobox name="country" aria-label="Country" options={COUNTRIES} defaultValue="de" />
      <MultiSelect name="labels" aria-label="Labels" options={PRIORITY} defaultValue={['low', 'high']} />
      <DatePicker name="due" defaultValue={new Date(2026, 10, 8)} />
      <DateRangePicker name="period" defaultValue={[new Date(2026, 10, 1), new Date(2026, 10, 7)]} />
      <TimePicker name="time" aria-label="Time" defaultValue="09:30" />
      <TagInput name="tags" defaultValue={['a, with comma', 'b']} />
      <Slider name="volume" label="Volume" defaultValue={40} />
      <RangeSlider name="price" label="Price" defaultValue={[10, 90]} />
      <OTPInput name="code" length={4} defaultValue="1234" />
      <PhoneInput name="phone" defaultValue="79 123 45 67" />
      <CurrencyInput name="amount" currencyName="currency" defaultValue={1234.5} />
      <Rating name="stars" defaultValue={4} />
      <ColorPicker name="colour" defaultValue="#16a34a" />
      <NumberStepper name="seats" defaultValue={3} />
      <SegmentedControl name="view" aria-label="View" options={['Day', 'Week']} defaultValue="Week" />
      <Switch name="notify" aria-label="Notify" defaultChecked />
      <Checkbox name="terms" value="yes" defaultChecked>Terms</Checkbox>
      <Checkbox name="digest">Digest</Checkbox>
      <RadioGroup name="plan" label="Plan" options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} defaultValue="yearly" />
      <Input name="email" aria-label="Email" defaultValue="a@b.co" />
      <Textarea name="bio" aria-label="Bio" defaultValue="Hi" />
    </>)
    const d = data()
    expect(d.get('priority')).toBe('high')
    expect(d.get('country')).toBe('de')
    expect(d.getAll('labels')).toEqual(['low', 'high'])
    expect(d.get('due')).toBe('2026-11-08')
    expect(d.getAll('period')).toEqual(['2026-11-01', '2026-11-07'])
    expect(d.get('time')).toBe('09:30')
    expect(d.getAll('tags')).toEqual(['a, with comma', 'b'])
    expect(d.get('volume')).toBe('40')
    expect(d.getAll('price')).toEqual(['10', '90'])
    expect(d.get('code')).toBe('1234')
    expect(d.get('phone')).toBe('+41791234567')
    expect(d.get('amount')).toBe('1234.5')
    expect(d.get('currency')).toBe('CHF')
    expect(d.get('stars')).toBe('4')
    expect(d.get('colour')).toBe('#16A34A')
    expect(d.get('seats')).toBe('3')
    expect(d.get('view')).toBe('Week')
    expect(d.get('notify')).toBe('on')
    expect(d.get('terms')).toBe('yes')
    expect(d.has('digest')).toBe(false)
    expect(d.get('plan')).toBe('yearly')
    expect(d.get('email')).toBe('a@b.co')
    expect(d.get('bio')).toBe('Hi')
  })

  it('submits empty values the way native fields do', () => {
    const { data } = inForm(<>
      <Select name="s" aria-label="S" options={PRIORITY} />
      <Combobox name="c" aria-label="C" options={COUNTRIES} />
      <MultiSelect name="m" aria-label="M" options={PRIORITY} />
      <DatePicker name="d" />
      <DateRangePicker name="r" />
      <Rating name="stars" />
      <PhoneInput name="phone" />
      <CurrencyInput name="amount" />
    </>)
    const d = data()
    expect(d.get('s')).toBe('')
    expect(d.get('c')).toBe('')
    expect(d.has('m')).toBe(false)
    expect(d.get('d')).toBe('')
    expect(d.getAll('r')).toEqual(['', ''])
    expect(d.get('stars')).toBe('')
    expect(d.get('phone')).toBe('')
    expect(d.get('amount')).toBe('')
  })

  it('updates the submitted value as the user edits, and fires input/change on the form', async () => {
    const user = userEvent.setup(), onInput = vi.fn()
    const { form, data } = inForm(<Select name="priority" aria-label="Priority" options={PRIORITY} />)
    form.addEventListener('input', onInput)
    await user.click(screen.getByRole('combobox', { name: 'Priority' }))
    await user.click(await screen.findByRole('option', { name: 'Medium' }))
    expect(data().get('priority')).toBe('medium')
    expect(onInput).toHaveBeenCalled()
  })

  it('a controlled value change from outside does not fire input', () => {
    const onInput = vi.fn()
    const { form, rerender } = inForm(<Select name="p" aria-label="P" options={PRIORITY} value="low" />)
    form.addEventListener('input', onInput)
    rerender(<form data-testid="f"><Select name="p" aria-label="P" options={PRIORITY} value="high" /></form>)
    expect(new FormData(form).get('p')).toBe('high')
    expect(onInput).not.toHaveBeenCalled()
  })

  it('honours the form attribute for a form elsewhere on the page', () => {
    render(<><form id="remote" data-testid="remote" /><Select form="remote" name="p" aria-label="P" options={PRIORITY} defaultValue="low" /></>)
    expect(new FormData(screen.getByTestId('remote') as HTMLFormElement).get('p')).toBe('low')
  })
})

describe('disabled, read-only and invalid', () => {
  it('disabled controls are not submitted and cannot be changed', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    const { data } = inForm(<>
      <Select name="s" aria-label="S" options={PRIORITY} defaultValue="low" disabled onChange={onChange} />
      <MultiSelect name="m" aria-label="M" options={PRIORITY} defaultValue={['low']} disabled />
      <Checkbox name="c" defaultChecked disabled>C</Checkbox>
      <NumberStepper name="n" label="N" defaultValue={2} disabled onChange={onChange} />
      <TagInput name="t" defaultValue={['x']} disabled />
    </>)
    expect([...data().keys()]).toEqual([])
    expect(screen.getByRole('combobox', { name: 'S' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'M' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('checkbox', { name: 'C' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Remove x' })).toBeNull()
    await user.click(screen.getByRole('combobox', { name: 'S' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'N' }), { key: 'ArrowUp' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('read-only controls submit but do not change', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    const { data } = inForm(<>
      <Select name="s" aria-label="S" options={PRIORITY} defaultValue="low" readOnly onChange={onChange} />
      <Switch name="w" aria-label="W" defaultChecked readOnly onChange={onChange} />
      <Rating name="r" defaultValue={3} readOnly onChange={onChange} />
    </>)
    await user.click(screen.getByRole('combobox', { name: 'S' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    await user.click(screen.getByRole('switch', { name: 'W' }))
    await user.click(screen.getByRole('radio', { name: '5 stars' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'W' })).toHaveAttribute('aria-readonly', 'true')
    expect(Object.fromEntries(data())).toEqual({ s: 'low', w: 'on', r: '3' })
  })

  it('invalid sets aria-invalid on the focusable element', () => {
    render(<>
      <Select aria-label="S" options={PRIORITY} invalid />
      <Combobox aria-label="C" options={COUNTRIES} invalid />
      <MultiSelect aria-label="M" options={PRIORITY} invalid />
      <PhoneInput invalid />
      <Checkbox invalid>Tick</Checkbox>
    </>)
    for (const el of [...screen.getAllByRole('combobox'), screen.getByRole('textbox', { name: 'Phone number' }), screen.getByRole('checkbox', { name: 'Tick' })])
      expect(el).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('required and focus on error', () => {
  it('a required custom control blocks submit, focuses itself and shows the message', async () => {
    const user = userEvent.setup(), onValues = vi.fn()
    render(
      <Form onValues={onValues} aria-label="F">
        <FormField label="Name" name="name"><Input /></FormField>
        <FormField label="Team" name="team" required description="Pick one"><Select options={PRIORITY} /></FormField>
        <FormField label="Tags" name="tags" required><TagInput /></FormField>
        <FormField name="terms" required><Checkbox>Accept</Checkbox></FormField>
        <button type="submit">Submit</button>
      </Form>,
    )
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onValues).not.toHaveBeenCalled()
    const team = screen.getByRole('combobox', { name: 'Team' })
    expect(document.activeElement).toBe(team)
    expect(team).toHaveAttribute('aria-invalid', 'true')
    const msgId = team.getAttribute('aria-describedby')!
    expect(document.getElementById(msgId)?.textContent).toMatch(/required|fill out|constraints/i)
    expect(screen.getByRole('checkbox', { name: 'Accept' })).toHaveAttribute('aria-invalid', 'true')

    // fix the fields: messages clear and the form submits
    await user.click(team)
    await user.click(await screen.findByRole('option', { name: 'High' }))
    await waitFor(() => expect(team).not.toHaveAttribute('aria-invalid'))
    expect(document.getElementById(msgId)?.textContent).toBe('Pick one')
    await user.type(screen.getByRole('textbox', { name: 'Tags' }), 'design{Enter}')
    await user.click(screen.getByRole('checkbox', { name: 'Accept' }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onValues).toHaveBeenCalledTimes(1)
    const data: FormData = onValues.mock.calls[0][0]
    expect(Object.fromEntries(data)).toEqual({ name: '', team: 'high', tags: 'design', terms: 'on' })
  })

  it('the browser focusing the required proxy moves focus to the real control', () => {
    const { form } = inForm(<DatePicker name="d" required />)
    const proxy = form.querySelector<HTMLInputElement>('input[required]')!
    let valid = true
    act(() => { valid = proxy.checkValidity() })
    expect(valid).toBe(false)
    act(() => proxy.focus())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Pick a date/ }))
    expect(screen.getByRole('button', { name: /Pick a date/ })).toHaveAttribute('aria-invalid', 'true') // the invalid event marked it
  })

  it('Form errors={…} shows server errors by field name', () => {
    render(<Form errors={{ email: 'Already taken' }}><FormField label="Email" name="email"><Input /></FormField></Form>)
    const input = screen.getByRole('textbox', { name: 'Email' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Already taken')
  })
})

describe('reset', () => {
  it('uncontrolled controls return to defaultValue on form reset', async () => {
    const user = userEvent.setup()
    const { form, data } = inForm(<>
      <Select name="s" aria-label="S" options={PRIORITY} defaultValue="low" />
      <Combobox name="c" aria-label="C" options={COUNTRIES} defaultValue="gb" />
      <TagInput name="t" defaultValue={['x']} />
      <Checkbox name="k">K</Checkbox>
      <OTPInput name="o" length={4} />
    </>)
    await user.click(screen.getByRole('combobox', { name: 'S' }))
    await user.click(await screen.findByRole('option', { name: 'High' }))
    const combo = screen.getByRole('combobox', { name: 'C' })
    await user.clear(combo); await user.type(combo, 'germ{ArrowDown}{Enter}')
    await user.type(screen.getByRole('textbox', { name: 'Add a tag…' }), 'y{Enter}')
    await user.click(screen.getByRole('checkbox', { name: 'K' }))
    await user.type(screen.getByRole('textbox', { name: 'Digit 1' }), '12')
    expect(Object.fromEntries(data())).toMatchObject({ s: 'high', c: 'de', k: 'on', o: '12' })
    act(() => form.reset())
    await waitFor(() => expect(Object.fromEntries(data())).toEqual({ s: 'low', c: 'gb', t: 'x', o: '' }))
    expect(combo).toHaveValue('United Kingdom')
    expect(screen.getByRole('checkbox', { name: 'K' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('textbox', { name: 'Digit 1' })).toHaveValue('')
  })
})

describe('ref focus', () => {
  it('every control forwards ref to its focusable element', () => {
    const refs = Array.from({ length: 15 }, () => createRef<HTMLElement>()) as never[]
    render(<>
      <Select ref={refs[0]} aria-label="a" options={PRIORITY} />
      <Combobox ref={refs[1]} aria-label="b" options={COUNTRIES} />
      <MultiSelect ref={refs[2]} aria-label="c" options={PRIORITY} />
      <DatePicker ref={refs[3]} />
      <DateRangePicker ref={refs[4]} />
      <TagInput ref={refs[5]} />
      <Slider ref={refs[6]} label="s" />
      <RangeSlider ref={refs[7]} label="r" />
      <OTPInput ref={refs[8]} />
      <PhoneInput ref={refs[9]} />
      <CurrencyInput ref={refs[10]} />
      <Rating ref={refs[11]} />
      <NumberStepper ref={refs[12]} />
      <Switch ref={refs[13]} aria-label="sw" />
      <Checkbox ref={refs[14]}>cb</Checkbox>
    </>)
    for (const r of refs as { current: HTMLElement | null }[]) {
      expect(r.current).toBeInstanceOf(HTMLElement)
      act(() => r.current!.focus())
      expect(document.activeElement).toBe(r.current)
    }
  })

  it('works with a Controller-style binding (value, onChange, onBlur, ref, name)', async () => {
    const user = userEvent.setup()
    const seen: { value?: string; blurred: number } = { blurred: 0 }
    const ref = createRef<HTMLButtonElement>()
    function Controlled() { // what react-hook-form's <Controller render={({ field }) => <Select {...field} />} /> passes
      const [value, setValue] = useState('')
      const field = { name: 'team', value, ref, onChange: (v: string) => { seen.value = v; setValue(v) }, onBlur: () => { seen.blurred++ } }
      return <><Select {...field} aria-label="Team" options={PRIORITY} /><button type="button">After</button></>
    }
    const { form } = inForm(<Controlled />)
    act(() => ref.current!.focus()) // shouldFocusError
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Team' }))
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(seen.value).toBe('medium')
    expect(new FormData(form).get('team')).toBe('medium')
    await user.tab()
    expect(seen.blurred).toBe(1)
  })

  it('register() binds the native-backed inputs', async () => {
    const user = userEvent.setup(), values: Record<string, string> = {}
    const register = (name: string) => ({ name, onChange: (e: { target: { name: string; value: string } }) => { values[e.target.name] = e.target.value }, onBlur: () => {}, ref: () => {} })
    render(<><Input aria-label="Email" {...register('email')} /><Textarea aria-label="Bio" {...register('bio')} /><PasswordInput aria-label="Password" {...register('pw')} /></>)
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'a@b.co')
    await user.type(screen.getByRole('textbox', { name: 'Bio' }), 'hi')
    await user.type(screen.getByLabelText('Password'), 'x1')
    expect(values).toEqual({ email: 'a@b.co', bio: 'hi', pw: 'x1' })
  })
})

describe('FormField wiring', () => {
  it('labels every kind of control and describes it', () => {
    render(<>
      <FormField label="Priority" description="How urgent"><Select options={PRIORITY} /></FormField>
      <FormField label="Labels"><MultiSelect options={PRIORITY} /></FormField>
      <FormField label="Seats"><NumberStepper /></FormField>
      <FormField label="Plan"><RadioGroup options={[{ value: 'a', label: 'A' }]} /></FormField>
      <FormField label="View"><SegmentedControl options={['Day', 'Week']} /></FormField>
      <FormField label="Due"><DatePicker /></FormField>
      <FormField label="Mobile"><PhoneInput /></FormField>
      <FormField label="Amount"><CurrencyInput /></FormField>
      <FormField label="Country"><Combobox options={COUNTRIES} /></FormField>
      <FormField label="Code"><OTPInput /></FormField>
      <FormField label="Score"><Rating /></FormField>
      <FormField label="Volume"><Slider /></FormField>
      <FormField label="Colour"><ColorPicker /></FormField>
      <Field label="Legacy field" htmlFor="legacy" hint="Still works"><Input id="legacy" /></Field>
    </>)
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveAccessibleDescription('How urgent')
    expect(screen.getByRole('combobox', { name: 'Labels' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Seats' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Due' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Mobile' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Country' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Code' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Score' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Colour' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Legacy field' })).toHaveAccessibleDescription('Still works')
  })

  it('error makes the control invalid and replaces the description', () => {
    render(<FormField label="Email" description="Work address" error="Use your work email" required><Input /></FormField>)
    const input = screen.getByRole('textbox', { name: /Email/ })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toBeRequired()
    expect(input).toHaveAccessibleDescription('Use your work email')
  })

  it('passes disabled and name down', () => {
    const { data } = inForm(<FormField label="P" name="p" disabled><Select options={PRIORITY} defaultValue="low" /></FormField>)
    expect(screen.getByRole('combobox', { name: 'P' })).toBeDisabled()
    expect(data().has('p')).toBe(false)
  })
})

describe('async Combobox', () => {
  it('debounces typing into one request', async () => {
    const user = fakeTimersUser({ shouldAdvanceTime: false })
    const load = vi.fn(async (q: string) => COUNTRIES.filter(o => o.label.toLowerCase().includes(q)))
    render(<Combobox aria-label="Country" loadOptions={load} debounce={60} />)
    await user.type(screen.getByRole('combobox'), 'unit')
    await tick(59)
    expect(load.mock.calls.filter(c => c[0] !== '')).toEqual([])
    await tick(1)
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(load.mock.calls.filter(c => c[0] !== '').map(c => c[0])).toEqual(['unit'])
  })

  it('aborts a stale request and drops its late results', async () => {
    const user = userEvent.setup()
    const pending: { q: string; signal: AbortSignal; resolve: (o: Option[]) => void }[] = []
    const load = (q: string, { signal }: { signal: AbortSignal }) => new Promise<Option[]>(resolve => { pending.push({ q, signal, resolve }) })
    render(<Combobox aria-label="Country" loadOptions={load} debounce={10} minChars={1} />)
    const input = screen.getByRole('combobox')
    await user.type(input, 'g')
    await waitFor(() => expect(pending.map(p => p.q)).toEqual(['g']))
    await user.type(input, 'e')
    await waitFor(() => expect(pending.map(p => p.q)).toEqual(['g', 'ge']))
    expect(pending[0].signal.aborted).toBe(true)
    await act(async () => { pending[0].resolve([{ value: 'stale', label: 'Stale' }]) })
    expect(screen.queryByRole('option', { name: 'Stale' })).toBeNull()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await act(async () => { pending[1].resolve([{ value: 'de', label: 'Germany' }]) })
    expect(screen.getByRole('option', { name: 'Germany' })).toBeInTheDocument()
    expect(screen.getByRole('listbox')).not.toHaveAttribute('aria-busy')
  })

  it('shows an error with retry', async () => {
    const user = userEvent.setup()
    let fail = true
    const load = vi.fn(async () => { if (fail) throw new Error('down'); return COUNTRIES })
    render(<Combobox aria-label="Country" loadOptions={load} debounce={5} />)
    await user.click(screen.getByRole('combobox'))
    expect(await screen.findByText('Couldn’t load results')).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('waits for minChars', async () => {
    const user = fakeTimersUser({ shouldAdvanceTime: false }), load = vi.fn(async () => COUNTRIES)
    render(<Combobox aria-label="Country" loadOptions={load} debounce={5} minChars={2} />)
    await user.type(screen.getByRole('combobox'), 'g')
    await tick(1000)
    expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
    await user.type(screen.getByRole('combobox'), 'e')
    await tick(5)
    expect(load).toHaveBeenCalledWith('ge', expect.anything())
  })

  it('creates a new option', async () => {
    const user = userEvent.setup(), onChange = vi.fn(), onCreate = vi.fn((t: string) => ({ value: t.toLowerCase(), label: t }))
    const { container } = render(<form><Combobox name="city" aria-label="City" options={COUNTRIES} creatable onCreate={onCreate} onChange={onChange} /></form>)
    await user.type(screen.getByRole('combobox'), 'Gotham')
    const create = await screen.findByRole('option', { name: 'Create “Gotham”' })
    expect(create).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onCreate).toHaveBeenCalledWith('Gotham')
    expect(onChange).toHaveBeenLastCalledWith('gotham')
    expect(screen.getByRole('combobox')).toHaveValue('Gotham')
    expect(new FormData(container.querySelector('form')!).get('city')).toBe('gotham')
  })

  it('reports typing with onInputChange and lists option groups', async () => {
    const user = userEvent.setup(), onInputChange = vi.fn()
    const opts: Option[] = [{ value: 'a', label: 'Apple', group: 'Fruit' }, { value: 'b', label: 'Banana', group: 'Fruit' }, { value: 'c', label: 'Carrot', group: 'Veg' }]
    render(<Combobox aria-label="Food" options={opts} onInputChange={onInputChange} />)
    await user.click(screen.getByRole('combobox'))
    const fruit = screen.getByRole('group', { name: 'Fruit' })
    expect(within(fruit).getAllByRole('option').map(o => o.textContent)).toEqual(['Apple', 'Banana'])
    expect(screen.getByRole('group', { name: 'Veg' })).toBeInTheDocument()
    await user.type(screen.getByRole('combobox'), 'ca')
    expect(onInputChange).toHaveBeenLastCalledWith('ca')
  })
})

describe('virtualised OptionList', () => {
  const many: Option[] = Array.from({ length: 5000 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }))

  it('renders a window of rows and keeps the active descendant rendered', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<Combobox aria-label="Big" options={many} onChange={onChange} />)
    const input = screen.getByRole('combobox')
    await user.click(input)
    const rendered = screen.getAllByRole('option')
    expect(rendered.length).toBeLessThan(100)
    expect(rendered[0]).toHaveAttribute('aria-setsize', '5000')
    for (let i = 0; i < 150; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    const id = input.getAttribute('aria-activedescendant')!
    const active = document.getElementById(id)
    expect(active).not.toBeNull()
    expect(active).toHaveTextContent('Option 150')
    expect(active).toHaveAttribute('aria-posinset', '151')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('v150')
  })

  it('works in Select and MultiSelect too', async () => {
    const user = userEvent.setup()
    const select = render(<Select aria-label="Pick" options={many} defaultValue="v2500" />)
    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    const id = screen.getByRole('combobox', { name: 'Pick' }).getAttribute('aria-activedescendant')!
    expect(document.getElementById(id)).toHaveTextContent('Option 2500')
    expect(screen.getAllByRole('option').length).toBeLessThan(100)
    select.unmount()
    render(<MultiSelect aria-label="Pick many" options={many} />)
    await user.click(screen.getByRole('combobox', { name: 'Pick many' }))
    const rendered = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(rendered.length).toBeLessThan(100)
    expect(rendered[0]).toHaveAttribute('aria-setsize', '5000')
  })
})

describe('FileUpload', () => {
  it('required blocks submit until a file is added', async () => {
    const user = userEvent.setup(), onValues = vi.fn()
    render(<Form onValues={onValues}><FormField label="Receipt" name="receipt" required><FileUpload /></FormField><button type="submit">Send</button></Form>)
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onValues).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Receipt/ }))
  })
})
