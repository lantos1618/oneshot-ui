// Package C (forms, pickers, upload): typed input in every parsing control, Combobox text vs value, async lists,
// impossible dates, currency separators, FileUpload counting and honest status, and the shared validity proxy.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  Combobox, CurrencyInput, DateField, FileUpload, Form, FormField, MonthPicker, NumberStepper, OTPInput, type Option, PhoneInput, RadioGroup,
  RangeSlider, Select, Slider, TagInput, YearPicker,
} from '../../src/lib/forms'

function inForm(children: ReactNode) {
  const r = render(<form data-testid="f">{children}</form>)
  const form = screen.getByTestId('f') as HTMLFormElement
  return { ...r, form, data: () => new FormData(form) }
}
const COUNTRIES: Option[] = [{ value: 'de', label: 'Germany' }, { value: 'fr', label: 'France' }, { value: 'ch', label: 'Switzerland' }]
const FRUIT: Option[] = [{ value: 'apple', label: 'Apple' }, { value: 'apricot', label: 'Apricot' }, { value: 'banana', label: 'Banana' }]
const seg = (name: RegExp) => screen.getByRole('spinbutton', { name })
const file = (name: string, size = 10, type = 'application/pdf') => new File(['x'.repeat(size)], name, { type })
const optionNames = () => screen.queryAllByRole('option').map(o => o.textContent)

describe('C-H1: Combobox text always matches its value', () => {
  it('unpicked text goes back to the label on blur; emptied text clears the value', async () => {
    const user = userEvent.setup()
    const { data } = inForm(<><Combobox name="c" aria-label="Country" options={COUNTRIES} defaultValue="de" /><button type="button">out</button></>)
    const input = screen.getByRole('combobox', { name: 'Country' })
    expect(input).toHaveValue('Germany')
    await user.click(input)
    await user.clear(input)
    await user.type(input, 'zz')
    await user.click(screen.getByRole('button', { name: 'out' }))
    expect(input).toHaveValue('Germany')
    expect(data().get('c')).toBe('de')
    await user.click(input)
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: 'out' }))
    expect(input).toHaveValue('')
    expect(data().get('c')).toBe('')
  })

  it('Escape with the list closed puts the label back', async () => {
    const user = userEvent.setup()
    render(<Combobox aria-label="Country" options={COUNTRIES} defaultValue="fr" />)
    const input = screen.getByRole('combobox', { name: 'Country' })
    await user.click(input)
    await user.type(input, 'x')
    await user.keyboard('{Escape}') // closes the list
    await user.keyboard('{Escape}') // then reverts the text
    expect(input).toHaveValue('France')
  })
})

describe('C-H2: async Combobox filters its static options', () => {
  it('lists only the static options that match the query', async () => {
    const user = userEvent.setup()
    render(<Combobox aria-label="Fruit" options={FRUIT} loadOptions={async () => []} debounce={0} />)
    await user.type(screen.getByRole('combobox', { name: 'Fruit' }), 'ap')
    await waitFor(() => expect(optionNames()).toEqual(['Apple', 'Apricot']))
  })
})

describe('C-H3: an impossible typed date is invalid, never another date', () => {
  it('31/02/2025 stays as typed, has no value and blocks the submit with "Enter a valid date"', async () => {
    const user = userEvent.setup(), onValues = vi.fn(), onChange = vi.fn()
    render(<Form onValues={onValues}><FormField label="Due" name="due"><DateField onChange={onChange} /></FormField><button>Send</button></Form>)
    await user.click(seg(/Day/))
    await user.keyboard('31022025')
    expect(seg(/Day/)).toHaveValue('31')
    expect(seg(/Month/)).toHaveValue('02')
    expect(seg(/Year/)).toHaveValue('2025')
    expect(onChange).not.toHaveBeenCalledWith(expect.any(Date))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onValues).not.toHaveBeenCalled()
    expect(seg(/Day/)).toHaveAccessibleDescription('Enter a valid date')
    expect(seg(/Day/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('29/02 becomes valid once a leap year is typed', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<DateField aria-label="D" onChange={onChange} />)
    await user.click(seg(/Day/))
    await user.keyboard('29022028')
    expect(onChange).toHaveBeenLastCalledWith(new Date(2028, 1, 29))
  })
})

describe('C-H4: CurrencyInput reads either separator', () => {
  const typeAmount = async (currency: string, text: string) => {
    const user = userEvent.setup(), onChange = vi.fn()
    const { unmount } = render(<CurrencyInput defaultCurrency={currency} onChange={onChange} />)
    await user.type(screen.getByRole('textbox'), text)
    const last = onChange.mock.calls.at(-1)
    unmount()
    return last
  }
  it.each([
    ['EUR', '12.50', 12.5], ['EUR', '12,50', 12.5], ['USD', '12,50', 12.5], ['USD', '12.50', 12.5], ['EUR', '1.234,56', 1234.56], ['USD', '1,234.56', 1234.56],
    ['EUR', '1.234', 1234], ['USD', '1,234', 1234], ['CHF', "1'234.5", 1234.5], ['GBP', '0012', 12],
  ])('%s "%s" → %s', async (currency, text, amount) => {
    expect(await typeAmount(currency, text)).toEqual([amount, currency])
  })

  it.each([['USD', '1.234'], ['EUR', '1,234'], ['USD', '12.5.6'], ['EUR', '-5'], ['USD', '1,23,456']])('%s "%s" is invalid and empties the value', async (currency, text) => {
    const user = userEvent.setup(), onChange = vi.fn()
    const { data } = inForm(<CurrencyInput name="a" defaultCurrency={currency} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    await user.type(input, text)
    expect(onChange).toHaveBeenLastCalledWith(null, currency)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveValue(text)
    expect(data().get('a')).toBe('')
    expect((screen.getByTestId('f') as HTMLFormElement).checkValidity()).toBe(false)
  })

  it('shows the currency’s separators once you leave the field', async () => {
    const user = userEvent.setup()
    const { data } = inForm(<><CurrencyInput name="a" defaultCurrency="EUR" /><button type="button">out</button></>)
    await user.type(screen.getByRole('textbox'), '1234.5')
    await user.click(screen.getByRole('button', { name: 'out' }))
    expect(screen.getByRole('textbox')).toHaveValue('1.234,50')
    expect(data().get('a')).toBe('1234.5')
  })
})

describe('C-H5: FileUpload without multiple holds one file', () => {
  it('a drop of two keeps one and reports the other; a later pick replaces it', async () => {
    const onReject = vi.fn()
    const { container } = render(<FileUpload multiple={false} onReject={onReject} />)
    const zone = screen.getByRole('button', { name: /Drop a file/ })
    fireEvent.drop(zone, { dataTransfer: { files: [file('a.pdf'), file('b.pdf')] } })
    expect(screen.getByText('a.pdf')).toBeInTheDocument()
    expect(screen.queryByText('b.pdf')).toBeNull()
    expect(onReject).toHaveBeenCalledWith([expect.objectContaining({ name: 'b.pdf' })], 'count')
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file('c.pdf')] } })
    expect(screen.getByText('c.pdf')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('a.pdf')).toBeNull()) // after its exit animation
  })
})

describe('C-H6: FileUpload never fakes an upload', () => {
  it('without an uploader a file is "Ready", with no progress and no "Uploaded"', async () => {
    render(<FileUpload />)
    fireEvent.drop(screen.getByRole('button', { name: /Drop files/ }), { dataTransfer: { files: [file('a.pdf')] } })
    expect(screen.getByText(/Ready/)).toBeInTheDocument()
    await new Promise(r => setTimeout(r, 300))
    expect(screen.queryByText(/Uploaded|Uploading/)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('defaultFiles show as existing files, not as an upload in progress', () => {
    render(<FileUpload upload={() => new Promise(() => {})} defaultFiles={[{ name: 'old.pdf', size: 2_000 }]} />)
    expect(screen.getByText('old.pdf')).toBeInTheDocument()
    expect(screen.queryByText(/Uploading/)).toBeNull()
  })

  it('maxSize turns away larger files and is the default hint', () => {
    const onReject = vi.fn()
    render(<FileUpload maxSize={20} accept=".pdf" onReject={onReject} />)
    expect(screen.getByText(/Accepts \.pdf, up to 20/)).toBeInTheDocument()
    fireEvent.drop(screen.getByRole('button', { name: /Drop files/ }), { dataTransfer: { files: [file('big.pdf', 50), file('ok.pdf', 5)] } })
    expect(onReject).toHaveBeenCalledWith([expect.objectContaining({ name: 'big.pdf' })], 'size')
    expect(screen.getByText('ok.pdf')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('“big.pdf” is over')
  })

  it('"Uploaded" only after the uploader resolves; a rejection shows "Upload failed" with Retry', async () => {
    let settle: Record<string, [() => void, () => void]> = {}
    const upload = vi.fn((f: File) => new Promise<void>((res, rej) => { settle[f.name] = [res, rej] }))
    render(<FileUpload upload={upload} />)
    fireEvent.drop(screen.getByRole('button', { name: /Drop files/ }), { dataTransfer: { files: [file('a.pdf'), file('b.pdf')] } })
    expect(screen.queryByText(/Uploaded/)).toBeNull()
    await act(async () => { settle['a.pdf'][0](); settle['b.pdf'][1]() })
    expect(screen.getByText(/Uploaded/)).toBeInTheDocument()
    expect(screen.getByText(/Upload failed/)).toBeInTheDocument()
    settle = {}
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(upload).toHaveBeenCalledTimes(3)
    await act(async () => { settle['b.pdf'][0]() })
    expect(screen.getAllByText(/Uploaded/)).toHaveLength(2)
  })
})

describe('C-H7: PhoneInput country picker', () => {
  it('is a combobox, so its aria-activedescendant is announced', async () => {
    const user = userEvent.setup()
    render(<PhoneInput />)
    const trigger = screen.getByRole('combobox', { name: /Country/ })
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-activedescendant')
    expect(document.getElementById(trigger.getAttribute('aria-activedescendant')!)).toHaveAttribute('role', 'option')
  })

  it('type-ahead cycles through the countries starting with a letter', async () => {
    const user = userEvent.setup()
    render(<PhoneInput />)
    const trigger = screen.getByRole('combobox', { name: /Country/ })
    await user.click(trigger)
    const active = () => document.getElementById(trigger.getAttribute('aria-activedescendant')!)?.textContent
    await user.keyboard('s')
    const first = active()
    await user.keyboard('s')
    expect(active()).not.toBe(first)
    expect(active()).toMatch(/Singapore|Spain|Switzerland/)
  })
})

describe('typed input: PhoneInput', () => {
  it('formats national digits with the mask and submits E.164', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    const { data } = inForm(<PhoneInput name="p" onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Phone number' })
    await user.type(input, '791234567')
    expect(input).toHaveValue('79 123 45 67')
    expect(data().get('p')).toBe('+41791234567')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ e164: '+41791234567', national: '79 123 45 67' }))
  })

  it('"0044…" switches the country; extra digits are dropped', async () => {
    const user = userEvent.setup()
    const { data } = inForm(<PhoneInput name="p" />)
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '00447911123456999')
    expect(screen.getByRole('combobox', { name: /Country: United Kingdom/ })).toBeInTheDocument()
    expect(data().get('p')).toBe('+447911123456')
  })

  it('C-M5: an emptied field reports e164 "", and a new value from the parent calls no onChange', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    const { rerender } = render(<PhoneInput value="+41791234567" onChange={onChange} />)
    rerender(<PhoneInput value="+41781111111" onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toHaveValue('78 111 11 11')
    render(<PhoneInput aria-label="Other" defaultValue="79" onChange={onChange} />)
    const other = screen.getByRole('textbox', { name: 'Other' })
    await user.clear(other)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ e164: '' }))
  })
})

describe('typed input: OTPInput', () => {
  it('auto-advances and completes', async () => {
    const user = userEvent.setup(), onComplete = vi.fn()
    const { data } = inForm(<OTPInput name="code" length={4} onComplete={onComplete} />)
    await user.click(screen.getByRole('textbox', { name: 'Digit 1' }))
    await user.keyboard('4821')
    expect(onComplete).toHaveBeenCalledWith('4821')
    expect(data().get('code')).toBe('4821')
  })

  it('C-M7: clearing a middle box leaves the other digits in place', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    const { data } = inForm(<OTPInput name="code" length={6} onChange={onChange} />)
    await user.click(screen.getByRole('textbox', { name: 'Digit 1' }))
    await user.keyboard('123456')
    fireEvent.change(screen.getByRole('textbox', { name: 'Digit 2' }), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith('1 3456', { complete: false })
    expect(screen.getAllByRole('textbox').map(b => (b as HTMLInputElement).value)).toEqual(['1', '', '3', '4', '5', '6'])
    expect(data().get('code')).toBe('') // not "13456"
  })

  it('paste fills every box', () => {
    const onComplete = vi.fn()
    render(<OTPInput length={4} onComplete={onComplete} />)
    fireEvent.paste(screen.getByRole('textbox', { name: 'Digit 1' }), { clipboardData: { getData: () => '12-34' } })
    expect(onComplete).toHaveBeenCalledWith('1234')
  })
})

describe('typed input: TagInput', () => {
  it('Enter and comma add tags, duplicates are not added, a pending tag is added on blur', async () => {
    const user = userEvent.setup()
    const { data } = inForm(<><TagInput name="t" /><button type="button">out</button></>)
    const input = screen.getByRole('textbox')
    await user.type(input, 'design{Enter}ux,design{Enter}research')
    expect(data().getAll('t')).toEqual(['design', 'ux'])
    await user.click(screen.getByRole('button', { name: 'out' }))
    expect(data().getAll('t')).toEqual(['design', 'ux', 'research'])
    await user.click(input)
    await user.keyboard('{Backspace}')
    expect(data().getAll('t')).toEqual(['design', 'ux'])
  })
})

describe('C-M1: async loader states', () => {
  it('a cancelled request leaves no spinner; a rejection reaches onLoadError', async () => {
    const user = userEvent.setup()
    const { container } = render(<Combobox aria-label="Slow" loadOptions={() => new Promise(() => {})} debounce={0} minChars={2} />)
    const input = screen.getByRole('combobox', { name: 'Slow' })
    const spinning = () => container.ownerDocument.querySelector('.animate-spin')
    await user.type(input, 'ab')
    await waitFor(() => expect(spinning()).not.toBeNull())
    await user.keyboard('{Backspace}') // below minChars: the request is cancelled
    expect(input).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(spinning()).toBeNull())
    expect(screen.getByText('Type at least 2 characters')).toBeInTheDocument()

    const onLoadError = vi.fn(), err = new Error('down')
    render(<Combobox aria-label="Broken" loadOptions={async () => { throw err }} debounce={0} onLoadError={onLoadError} />)
    await user.type(screen.getByRole('combobox', { name: 'Broken' }), 'x')
    await waitFor(() => expect(onLoadError).toHaveBeenCalledWith(err))
  })
})

describe('C-M2 / C-M3: Combobox and Select labels and values', () => {
  it('shows the label of a value whose options arrive later', () => {
    const { rerender } = render(<Combobox aria-label="C" options={[]} defaultValue="ch" />)
    expect(screen.getByRole('combobox')).toHaveValue('')
    rerender(<Combobox aria-label="C" options={COUNTRIES} defaultValue="ch" />)
    expect(screen.getByRole('combobox')).toHaveValue('Switzerland')
  })

  it('a value missing from options submits nothing', () => {
    const { data } = inForm(<><Select name="s" options={COUNTRIES} value="xx" /><Combobox name="c" options={COUNTRIES} value="xx" /></>)
    expect(data().get('s')).toBe('')
    expect(data().get('c')).toBe('')
  })
})

describe('C-M4: RadioGroup starts empty', () => {
  it('submits nothing until a choice is made, and required fails', () => {
    const { data, form } = inForm(<RadioGroup name="plan" options={COUNTRIES} required />)
    expect(data().has('plan')).toBe(false)
    expect(form.checkValidity()).toBe(false)
    expect(screen.getAllByRole('radio').every(r => r.getAttribute('aria-checked') === 'false')).toBe(true)
  })
})

describe('C-M6: controlled controls follow their value', () => {
  it('a CurrencyInput whose parent rejects the change keeps showing the parent’s value', async () => {
    const user = userEvent.setup()
    render(<CurrencyInput defaultCurrency="USD" value={5} onChange={() => {}} />)
    await user.type(screen.getByRole('textbox'), '7')
    expect(screen.getByRole('textbox')).toHaveValue('5')
  })

  it('an OTPInput and a PhoneInput whose parent rejects the change keep the parent’s value', async () => {
    const user = userEvent.setup()
    render(<><OTPInput length={4} value="12" onChange={() => {}} /><PhoneInput value="+41791234567" onChange={() => {}} /></>)
    await user.click(screen.getByRole('textbox', { name: 'Digit 3' }))
    await user.keyboard('9')
    expect(screen.getByRole('textbox', { name: 'Digit 3' })).toHaveValue('')
    await user.type(screen.getByRole('textbox', { name: 'Phone number' }), '9')
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue('79 123 45 67')
  })

  it('a parent that accepts the change sees the new values', async () => {
    const user = userEvent.setup()
    function Parent() { const [v, setV] = useState<number | null>(null); return <><CurrencyInput defaultCurrency="EUR" value={v} onChange={setV} /><output>{String(v)}</output></> }
    render(<Parent />)
    await user.type(screen.getByRole('textbox'), '3,5')
    expect(document.querySelector('output')).toHaveTextContent('3.5')
    expect(screen.getByRole('textbox')).toHaveValue('3,5')
  })
})

describe('C-M8 / C-M9: steps without float drift; values on the grid', () => {
  it('NumberStepper with step 0.1 reaches exactly 0.3', () => {
    const { data } = inForm(<NumberStepper name="n" step={0.1} />)
    const sb = screen.getByRole('spinbutton')
    for (let i = 0; i < 3; i++) fireEvent.keyDown(sb, { key: 'ArrowUp' })
    expect(data().get('n')).toBe('0.3')
    expect(sb).toHaveAttribute('aria-valuenow', '0.3')
  })

  it('Slider and RangeSlider defaults land on the step grid inside min/max', () => {
    const { data } = inForm(<><Slider name="s" defaultValue={7} step={5} /><RangeSlider name="r" min={0} max={10} /><RangeSlider name="g" min={0} max={10} step={3} defaultValue={[8, 1]} minGap={4} /></>)
    expect(data().get('s')).toBe('5')
    expect(data().getAll('r')).toEqual(['0', '10'])
    const [lo, hi] = data().getAll('g').map(Number)
    expect(lo).toBeLessThanOrEqual(hi - 4)
    expect(lo).toBeGreaterThanOrEqual(0)
    expect(hi).toBeLessThanOrEqual(10)
  })
})

describe('C-M10: FileUpload aborts removed uploads and leaves failures out', () => {
  it('removing a row mid-upload aborts it; a failed file does not satisfy required', async () => {
    const signals: AbortSignal[] = []
    let fail: () => void = () => {}
    const upload = vi.fn((_f: File, _p: (n: number) => void, { signal }: { signal: AbortSignal }) => { signals.push(signal); return new Promise<void>((_r, rej) => { fail = rej }) })
    const { form } = inForm(<FileUpload upload={upload} required />)
    fireEvent.drop(screen.getByRole('button', { name: /Drop files/ }), { dataTransfer: { files: [file('a.pdf')] } })
    expect(form.checkValidity()).toBe(true)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove a.pdf' }))
    expect(signals[0].aborted).toBe(true)
    fireEvent.drop(screen.getByRole('button', { name: /Drop files/ }), { dataTransfer: { files: [file('b.pdf')] } })
    await act(async () => { fail() })
    expect(screen.getByText(/Upload failed/)).toBeInTheDocument()
    expect(form.checkValidity()).toBe(false)
  })
})

describe('C-M11: MonthPicker and YearPicker check min and max', () => {
  it('a value outside the bounds is invalid and blocks the submit', () => {
    const { form } = inForm(<>
      <MonthPicker name="m" defaultValue={new Date(2027, 2, 1)} max={new Date(2026, 11, 31)} />
      <YearPicker name="y" defaultValue={2020} min={new Date(2024, 0, 1)} />
    </>)
    expect(screen.getByRole('button', { name: /March 2027/ })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: /2020/ })).toHaveAttribute('aria-invalid', 'true')
    expect(form.checkValidity()).toBe(false)
    const messages = [...form.querySelectorAll('input')].map(i => i.validationMessage).filter(Boolean)
    expect(messages).toEqual(['Choose December 2026 or earlier', 'Choose 2024 or later'])
  })

  it('an in-range value is fine', () => {
    const { form } = inForm(<MonthPicker name="m" defaultValue={new Date(2026, 2, 1)} max={new Date(2026, 11, 31)} />)
    expect(form.checkValidity()).toBe(true)
    expect(within(form).getByRole('button')).not.toHaveAttribute('aria-invalid')
  })
})
