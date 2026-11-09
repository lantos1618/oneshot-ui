// Forms 0.4 wave 2: the forms split (barrel and subpaths), the module catalogs in de/ar, RTL keys and pointer maths,
// DateTimePicker's own zone field, InlineDatePicker in pickers, the merged ShortcutSheet, and sample data out of the library.
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider, type MessageDefs } from '../../src/lib/core'
import * as forms from '../../src/lib/forms'
import * as fields from '../../src/lib/fields'
import * as inputs from '../../src/lib/inputs'
import * as select from '../../src/lib/select'
import * as pickers from '../../src/lib/pickers'
import * as upload from '../../src/lib/upload'
import * as lib from '../../src/lib'
import * as examples from '../../src/examples'
import { DATA_MESSAGES, ShortcutOverlay, ShortcutSheet, TaskList } from '../../src/lib/data'
import { EDITOR_MESSAGES, RichTextEditor } from '../../src/lib/editor'

const { DATE_FIELD_MESSAGES, DATE_PICKER_MESSAGES, DateTimePicker, InlineDatePicker, DateRangePicker } = pickers
const { FORM_MESSAGES } = fields
const { INPUT_MESSAGES, NumberStepper, OTPInput, PhoneInput, RangeSlider, Rating, Slider, TagInput } = inputs
const { SELECT_MESSAGES, Combobox } = select
const { UPLOAD_MESSAGES, FileUpload } = upload

const ar = (ui: ReactNode) => render(<LocaleProvider locale="ar-EG">{ui}</LocaleProvider>)
const de = (ui: ReactNode) => render(<LocaleProvider locale="de-DE">{ui}</LocaleProvider>)

describe('forms split', () => {
  it('`forms` re-exports every name of fields, inputs, select, pickers and upload (and the main entry has them)', () => {
    for (const mod of [fields, inputs, select, pickers, upload]) {
      for (const name of Object.keys(mod)) {
        expect(forms, `forms.${name}`).toHaveProperty(name)
        expect(lib, `@lyndon/ui ${name}`).toHaveProperty(name)
      }
    }
    expect(Object.keys(forms).sort()).toEqual([...new Set([fields, inputs, select, pickers, upload].flatMap(m => Object.keys(m)))].sort())
  })

  it('InlineDatePicker now lives in pickers; ShortcutOverlay stays as an alias of ShortcutSheet', () => {
    expect(pickers.InlineDatePicker).toBe(lib.InlineDatePicker)
    expect(lib.ShortcutOverlay).toBe(ShortcutOverlay)
  })

  it('sample editor content is only in @lyndon/ui/examples', () => {
    for (const n of ['RTE_SAMPLE', 'MENTION_PEOPLE', 'MENTION_COMMANDS']) {
      expect(lib).not.toHaveProperty(n)
      expect(examples).toHaveProperty(n)
    }
    expect(examples.RTE_SAMPLE).toContain('<h2>Launch notes</h2>')
    expect(examples.MENTION_PEOPLE.map(p => p.name)).toContain('Alex Lee')
  })
})

describe('module catalogs', () => {
  const catalogs: [string, MessageDefs][] = [['form', FORM_MESSAGES], ['input', INPUT_MESSAGES], ['select', SELECT_MESSAGES], ['date (fields)', DATE_FIELD_MESSAGES],
    ['date (pickers)', DATE_PICKER_MESSAGES], ['upload', UPLOAD_MESSAGES], ['data', DATA_MESSAGES], ['editor', EDITOR_MESSAGES]]
  it.each(catalogs)('%s has a German and an Arabic draft for every key, with the same placeholders', (_, defs) => {
    const keys = Object.keys(defs.en).sort()
    for (const lang of ['de', 'ar']) {
      const cat = defs.catalogs[lang] as Record<string, string>
      expect(Object.keys(cat).sort(), lang).toEqual(keys)
      for (const k of keys) {
        const vars = (s: string) => [...s.matchAll(/\{(\w+)\s*[,}]/g)].map(m => m[1]).sort()
        expect(new Set(vars(cat[k])), `${lang} ${k}`).toEqual(new Set(vars((defs.en as Record<string, string>)[k])))
      }
    }
  })
})

describe('Arabic and German', () => {
  it('input controls speak the locale', () => {
    ar(<><Rating /><NumberStepper /><OTPInput length={2} /><TagInput /><PhoneInput defaultCountry="+49" /></>)
    expect(screen.getByRole('radiogroup', { name: 'التقييم' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'نجمتان' })).toBeInTheDocument() // Arabic's dual
    expect(screen.getByRole('spinbutton', { name: 'الكمية' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'الرقم ١' })).toBeInTheDocument() // Arabic-Indic digits
    expect(screen.getByRole('textbox', { name: 'أضف وسمًا…' })).toBeInTheDocument()
    // country names come from Intl.DisplayNames
    expect(screen.getByRole('button', { name: /^الدولة: ألمانيا \+49$/ })).toBeInTheDocument()
  })

  it('the date pickers follow the locale prop too (DateRangePicker presets in German)', async () => {
    const user = userEvent.setup()
    render(<DateRangePicker locale="de-DE" aria-label="Zeitraum" />)
    expect(screen.getByRole('button', { name: /Zeitraum/ })).toHaveTextContent('Zeitraum auswählen')
    await user.click(screen.getByRole('button', { name: /Zeitraum/ }))
    const dialog = screen.getByRole('dialog', { name: 'Zeitraum wählen' })
    expect(within(dialog).getByRole('button', { name: 'Letzte 7 Tage' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Fertig' })).toBeInTheDocument()
  })

  it('Combobox empty and create messages, FileUpload and the editor in German', async () => {
    const user = userEvent.setup()
    de(<><Combobox aria-label="Stadt" options={[{ value: 'b', label: 'Berlin' }]} creatable /><FileUpload /><RichTextEditor /><TaskList /></>)
    await user.type(screen.getByRole('combobox', { name: 'Stadt' }), 'Zug')
    expect(screen.getByRole('option', { name: '„Zug“ erstellen' })).toBeInTheDocument()
    expect(screen.getByText('Dateien ablegen')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Formatierung' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fett' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Neue Aufgabe' })).toBeInTheDocument()
  })
})

describe('RTL', () => {
  it('RangeSlider: ArrowLeft raises a thumb and the low end starts at the right', () => {
    const onChange = vi.fn()
    ar(<RangeSlider defaultValue={[20, 80]} onChange={onChange} />)
    const low = screen.getByRole('slider', { name: 'الحد الأدنى' })
    expect(low.style.insetInlineStart).toBe('20%')
    fireEvent.keyDown(low, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith([21, 80])
  })

  it('Rating and NumberStepper: ArrowLeft is "more" in RTL', () => {
    const onRate = vi.fn(), onStep = vi.fn()
    ar(<><Rating defaultValue={2} onChange={onRate} /><NumberStepper defaultValue={3} onChange={onStep} /></>)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'نجمتان' }), { key: 'ArrowLeft' })
    expect(onRate).toHaveBeenLastCalledWith(3)
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'الكمية' }), { key: 'ArrowLeft' })
    expect(onStep).toHaveBeenLastCalledWith(4)
  })

  it('phone and OTP digits stay left to right inside an RTL form', () => {
    ar(<><PhoneInput /><OTPInput length={4} /><Slider label="x" /></>)
    expect(screen.getByRole('textbox', { name: 'رقم الهاتف' }).closest('[dir]')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByRole('group', { name: 'رمز لمرة واحدة' })).toHaveAttribute('dir', 'ltr')
  })
})

describe('DateTimePicker zone field and InlineDatePicker', () => {
  it('the zone field lists zones lazily, filters as you type and keeps the wall time', async () => {
    const user = userEvent.setup()
    function Demo() {
      const [v, setV] = useState<string | null>('2026-11-15T09:30:00+01:00')
      return <><DateTimePicker aria-label="Kick-off" value={v} onChange={setV} defaultTimeZone="Europe/Zurich" timeZonePicker /><output>{v}</output></>
    }
    render(<Demo />)
    expect(screen.queryByRole('listbox')).toBeNull() // nothing built until it opens
    const zone = screen.getByRole('combobox', { name: 'Time zone' })
    expect(zone).toHaveValue('(GMT+01:00) Europe/Zurich')
    await user.click(zone)
    expect(within(screen.getByRole('listbox', { name: 'Time zone' })).getAllByRole('option').length).toBeGreaterThan(300)
    await user.clear(zone)
    await user.type(zone, 'Tokyo{Enter}')
    expect(document.querySelector('output')!.textContent).toBe('2026-11-15T09:30:00+09:00')
    await user.clear(zone)
    await user.type(zone, 'Nowhere')
    expect(screen.getByText('No matching time zones')).toHaveAttribute('role', 'status')
  })

  it('InlineDatePicker: typing a date in the DateField moves the calendar and the summary', async () => {
    const user = userEvent.setup(), onChange = vi.fn()
    render(<InlineDatePicker onChange={onChange} locale="en-GB" />)
    await user.click(screen.getByRole('spinbutton', { name: /Day/ }))
    await user.keyboard('08112026')
    expect(onChange).toHaveBeenLastCalledWith([new Date(2026, 10, 8), new Date(2026, 10, 8)])
    expect(screen.getByText('8 Nov 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Date range' }))
    expect(screen.getByRole('group', { name: 'To date' })).toBeInTheDocument()
  })
})

describe('ShortcutSheet', () => {
  const groups = [{ title: 'General', items: [['Search', ['⌘', 'K']]] as [string, string[]][] }]
  it('renders inline, or as a dialog with variant="dialog"; ShortcutOverlay still works', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn()
    const { rerender } = render(<ShortcutSheet groups={groups} />)
    expect(screen.getByRole('region', { name: 'General' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<ShortcutSheet variant="dialog" open onOpenChange={onOpenChange} groups={groups} />)
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(<ShortcutOverlay open onOpenChange={onOpenChange} groups={groups} />)
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })
})
