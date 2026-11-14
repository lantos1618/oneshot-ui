// The forms split (barrel and subpaths), DateTimePicker's own zone field, InlineDatePicker in pickers, the merged
// ShortcutSheet. (Sample data staying out of the library is checked in consolidated.test.tsx.)
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import * as forms from '../../src/lib/forms'
import * as fields from '../../src/lib/fields'
import * as inputs from '../../src/lib/inputs'
import * as select from '../../src/lib/select'
import * as pickers from '../../src/lib/pickers'
import * as upload from '../../src/lib/upload'
import * as lib from '../../src/lib'
import { ShortcutSheet } from '../../src/lib/data'

const { DateTimePicker, InlineDatePicker } = pickers

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
    render(<InlineDatePicker onChange={onChange} />)
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
  it('renders inline, or as a dialog with variant="dialog"', async () => {
    const user = userEvent.setup(), onOpenChange = vi.fn()
    const { rerender } = render(<ShortcutSheet groups={groups} />)
    expect(screen.getByRole('region', { name: 'General' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<ShortcutSheet variant="dialog" open onOpenChange={onOpenChange} groups={groups} />)
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
