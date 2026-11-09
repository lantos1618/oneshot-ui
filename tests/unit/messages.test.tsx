// Module-owned message catalogs (0.4 wave 2): defineMessages / useMessages / createMessagesTranslator / messageCatalog.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LocaleProvider, createMessagesTranslator, defineMessages, messageCatalog, useMessages } from '../../src/lib'

describe('defineMessages / useMessages (module catalogs)', () => {
  const M = defineMessages('demo', {
    en: { items: '{n, plural, one {# item} other {# items}}', close: 'Close' },
    de: { items: '{n, plural, one {# Eintrag} other {# Einträge}}' },
    ar: { close: 'إغلاق' },
  })
  it('looks up provider messages, then the locale catalog (tag, language), then English, then the key', () => {
    expect(createMessagesTranslator(M, 'de-DE')('items', { n: 2 })).toBe('2 Einträge')
    expect(createMessagesTranslator(M, 'de-DE')('close')).toBe('Close')
    expect(createMessagesTranslator(M, 'ar-EG')('close')).toBe('إغلاق')
    expect(createMessagesTranslator(M, 'de', { 'demo.close': 'Zu' })('close')).toBe('Zu')
    expect(createMessagesTranslator(M, 'en-US')('items', { n: 1 })).toBe('1 item')
    // @ts-expect-error: keys are typed from `en`
    expect(createMessagesTranslator(M, 'en')('nope')).toBe('nope')
    expect(messageCatalog(M, 'ar')).toEqual({ 'demo.items': '{n, plural, one {# item} other {# items}}', 'demo.close': 'إغلاق' })
  })
  it('useMessages follows the provider locale and its overrides', () => {
    function X() { const t = useMessages(M); return <p>{t('items', { n: 3 })} · {t('close')}</p> }
    render(<LocaleProvider locale="de-DE" messages={{ 'demo.close': 'Schließen' }}><X /></LocaleProvider>)
    expect(screen.getByText('3 Einträge · Schließen')).toBeTruthy()
  })
})
