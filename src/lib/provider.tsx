import { type ReactNode, useLayoutEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { DEFAULT_THEME, FONT_CSS, LocaleProvider, type LocaleSettings, THEME_LEGACY_KEY, THEME_STORAGE_KEY, THEME_TOKEN_NAMES, THEME_VALUE_SOURCE, TOKENS, ThemeProvider, type ThemeSettings, UIHosts, UI_DIR_CSS, type UIMessages, cn, themeStyle, themeTokens, useLocale, useTheme } from './core'

export type UIProviderProps = LocaleSettings & {
  children: ReactNode
  className?: string
  /** Settings to start from before the user picks anything (and what Reset returns to), e.g. { theme: 'nord', mode: 'dark' }. */
  defaultTheme?: Partial<ThemeSettings>
  /** localStorage key for the saved appearance (default 'ui-theme:v1'; a value under the old 'ui-theme' key is migrated once). Pass the same key to ThemeScript. */
  storageKey?: string
  /** Remember the user's theme in localStorage (default true). */
  persist?: boolean
  /**
   * Load Geist and the theme fonts from Google Fonts (default false). Off: nothing is fetched from outside your origin
   * and --font falls back to the system stack (ui-sans-serif, system-ui…). On: requests go to fonts.googleapis.com and
   * fonts.gstatic.com (allow them in your CSP: style-src and font-src).
   */
  fonts?: boolean
  /**
   * Where the theme's CSS variables go. 'html' (default): on <html>, with the page background themed too.
   * 'self': on the provider's own `.ui-root` wrapper only, leaving the host page alone (overlays portal into it).
   */
  target?: 'html' | 'self'
  /** CSP nonce for the `<style>` elements UIProvider renders (the same value as your `style-src 'nonce-…'`). */
  nonce?: string
  /**
   * Render the token `<style>` (default true). Set false under a strict CSP without nonces and link the same CSS
   * instead: `import '@lyndon/ui/tokens.css'` (or `<link rel="stylesheet" href=".../dist/tokens.css">`). With `fonts`
   * on, the Google Fonts stylesheet is then added as a `<link>` rather than an inline `@import`.
   */
  injectStyles?: boolean
}

/** The page background and text colour, on `html`: added with target="html" (dist/tokens.css carries the same rule). */
const PROVIDER_PAGE_CSS = 'html{background:var(--bg);color:var(--fg)}'

/** The Google Fonts stylesheet behind FONT_CSS, for a `<link>` when inline styles are off. */
const PROVIDER_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap'

/**
 * Wrap your app once. Injects the tokens (and, with `fonts`, the Geist import), applies the theme, hosts page-level UI
 * (the toast region, mounted on the first `useToast()` toast) inside the themed `.ui-root` wrapper, and turns motion off
 * for reduced-motion users. Makes no outside requests unless `fonts`.
 * `locale`/`dir`/`timeZone`/`weekStartsOn`/`messages` set what `useLocale()` returns (default en-GB, ltr) and put
 * `lang`/`dir` on the wrapper (and on <html> with target="html").
 */
export function UIProvider({ children, className, defaultTheme, storageKey, persist, fonts = false, target = 'html', nonce, injectStyles = true,
  locale, dir, timeZone, weekStartsOn, hourCycle, messages }: UIProviderProps) {
  return (
    <MotionConfig reducedMotion="user" nonce={nonce}>
      {fonts && (injectStyles ? <style nonce={nonce}>{FONT_CSS}</style> : <link rel="stylesheet" href={PROVIDER_FONT_HREF} nonce={nonce} />)}
      {injectStyles && <style nonce={nonce}>{(target === 'html' ? TOKENS + '\n' + PROVIDER_PAGE_CSS : TOKENS) + '\n' + UI_DIR_CSS}</style>}
      <LocaleProvider locale={locale} dir={dir} timeZone={timeZone} weekStartsOn={weekStartsOn} hourCycle={hourCycle} messages={messages}>
        <ThemeProvider defaultSettings={defaultTheme} storageKey={storageKey} persist={persist} fonts={fonts} target={target}>
          <UIProviderRoot className={className}>
            {children}
            <UIHosts />
          </UIProviderRoot>
        </ThemeProvider>
      </LocaleProvider>
    </MotionConfig>
  )
}

/**
 * The `.ui-root` wrapper. It always carries `lang` and `dir` (rendered on the server too, so the markup matches);
 * with target="html" they also go on <html> after hydration (and are put back on unmount). With target="self"
 * it carries the theme (after hydration, so server and client markup match).
 */
function UIProviderRoot({ className, children }: { className?: string; children: ReactNode }) {
  const { target, ready, tokens, dark } = useTheme()
  const { locale, dir } = useLocale()
  const self = target === 'self' && ready
  useLayoutEffect(() => {
    if (target !== 'html') return
    const html = document.documentElement, was = [html.getAttribute('lang'), html.getAttribute('dir')] as const
    html.setAttribute('lang', locale); html.setAttribute('dir', dir)
    return () => {
      if (was[0] === null) html.removeAttribute('lang'); else html.setAttribute('lang', was[0])
      if (was[1] === null) html.removeAttribute('dir'); else html.setAttribute('dir', was[1])
    }
  }, [target, locale, dir])
  return <div className={cn('ui-root', className)} lang={locale} dir={dir} data-theme={self ? (dark ? 'dark' : 'light') : undefined} style={self ? themeStyle(tokens, dark) : undefined}>{children}</div>
}

const themeScriptJSON = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/**
 * The source of ThemeScript's inline script, for frameworks that take a string (e.g. a CSP-hashed <script>).
 * It reads the saved appearance and applies data-theme, color-scheme and the saved CSS variables to <html>. The saved
 * `css` is used only when every name is a library token and every value matches the patterns themeTokens produces
 * (hex, rgba(), numbers/px, the two shadows, the font stack); otherwise the defaults (or nothing) are applied.
 * With the default key it also reads the legacy 'ui-theme' value until ThemeProvider has migrated it.
 */
export function themeScriptSource({ storageKey = THEME_STORAGE_KEY, defaultTheme, persist = true }: { storageKey?: string; defaultTheme?: Partial<ThemeSettings>; persist?: boolean } = {}) {
  const d = { ...DEFAULT_THEME, ...defaultTheme }
  const fallback = { theme: d.theme, mode: d.mode, useCustom: d.useCustom, custom: d.custom ? { dark: !!d.custom.dark } : null, css: { light: themeTokens(d, false), dark: themeTokens(d, true) } }
  const legacy = storageKey === THEME_STORAGE_KEY ? THEME_LEGACY_KEY : null
  return `(function(k,l,d,N,V){try{var e=document.documentElement,s=null,R=new RegExp(V);if(k)try{var r=localStorage.getItem(k);if(r==null&&l)r=localStorage.getItem(l);s=JSON.parse(r)}catch(x){}
if(!s||typeof s!=="object"||Array.isArray(s))s=d;var ok=function(t){if(!t||typeof t!=="object")return null;for(var n in t)if(!Object.prototype.hasOwnProperty.call(t,n)||N.indexOf(n)<0||typeof t[n]!=="string"||!R.test(t[n]))return null;return t},
m=s.mode==="light"||s.mode==="dark"||s.mode==="system"?s.mode:d.mode,u=s.useCustom===true&&s.custom&&typeof s.custom==="object",
dk=u?s.custom.dark===true:m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches),
c=s.css&&typeof s.css==="object"?s.css:((s.theme||d.theme)===d.theme&&!u?d.css:null),t=c&&ok(c[dk?"dark":"light"]);
if(t)for(var n in t)e.style.setProperty("--"+n,t[n]);e.setAttribute("data-theme",dk?"dark":"light");e.style.colorScheme=dk?"dark":"light"}catch(x){}})(${persist ? themeScriptJSON(storageKey) : 'null'},${persist ? themeScriptJSON(legacy) : 'null'},${themeScriptJSON(fallback)},${themeScriptJSON(THEME_TOKEN_NAMES)},${themeScriptJSON(THEME_VALUE_SOURCE)})`
}

/**
 * A blocking inline script for the server-rendered <head>: applies the saved theme (or the defaults and the
 * OS scheme) to <html> before the first paint, so there is no flash of the wrong theme. Give it the same
 * `storageKey`/`defaultTheme`/`persist` as UIProvider, and put `suppressHydrationWarning` on <html>, since the
 * script changes its attributes before React hydrates. Only useful with target="html" and server rendering.
 * Under a strict CSP pass your `nonce` (or hash themeScriptSource()).
 */
export function ThemeScript({ nonce, ...opts }: { storageKey?: string; defaultTheme?: Partial<ThemeSettings>; persist?: boolean; nonce?: string }) {
  return <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScriptSource(opts) }} />
}

/* Example catalogs ─────────────────────────────────────────────────────────── */

/**
 * German UI strings for `<UIProvider locale="de-DE" messages={UI_MESSAGES_DE}>`.
 * Machine-drafted for 0.4: have a native speaker review before shipping to users.
 */
export const UI_MESSAGES_DE: UIMessages = {
  'common.close': 'Schließen', 'common.cancel': 'Abbrechen', 'common.confirm': 'Bestätigen', 'common.done': 'Fertig', 'common.ok': 'OK',
  'common.save': 'Speichern', 'common.saved': 'Gespeichert', 'common.delete': 'Löschen', 'common.edit': 'Bearbeiten', 'common.editItem': '{name} bearbeiten',
  'common.add': 'Hinzufügen', 'common.remove': 'Entfernen', 'common.removeItem': '{name} entfernen', 'common.open': 'Öffnen', 'common.openItem': '{name} öffnen',
  'common.copy': 'Kopieren', 'common.copied': 'Kopiert', 'common.copyFailed': 'Kopieren fehlgeschlagen', 'common.clipboardBlocked': 'Zwischenablage blockiert',
  'common.search': 'Suchen', 'common.searchPlaceholder': 'Suchen…', 'common.filter': 'Filtern', 'common.clear': 'Leeren', 'common.clearAll': 'Alle entfernen',
  'common.reset': 'Zurücksetzen', 'common.retry': 'Erneut versuchen', 'common.retryNow': 'Jetzt erneut versuchen', 'common.undo': 'Rückgängig', 'common.redo': 'Wiederholen',
  'common.send': 'Senden', 'common.sending': 'Wird gesendet…', 'common.continue': 'Weiter', 'common.back': 'Zurück', 'common.previous': 'Zurück', 'common.next': 'Weiter',
  'common.more': 'Mehr', 'common.moreActions': 'Weitere Aktionen', 'common.moreCount': '{count} weitere', 'common.showMore': 'Mehr anzeigen', 'common.showLess': 'Weniger anzeigen',
  'common.expand': 'Aufklappen', 'common.collapse': 'Zuklappen', 'common.expandAll': 'Alle aufklappen', 'common.collapseAll': 'Alle zuklappen',
  'common.select': 'Auswählen…', 'common.selectAll': 'Alle auswählen', 'common.selectedCount': '{count, plural, =0 {Nichts ausgewählt} other {# ausgewählt}}',
  'common.dismiss': 'Ausblenden', 'common.settings': 'Einstellungen', 'common.menu': 'Menü', 'common.required': 'Erforderlich', 'common.optional': 'Optional',
  'common.play': 'Abspielen', 'common.pause': 'Pausieren', 'common.zoomIn': 'Vergrößern', 'common.zoomOut': 'Verkleinern', 'common.approve': 'Genehmigen', 'common.reject': 'Ablehnen',
  'common.upload': 'Hochladen', 'common.addFiles': 'Dateien hinzufügen', 'common.dropFiles': 'Dateien zum Anhängen ablegen',
  'status.loading': 'Wird geladen', 'status.loadingEllipsis': 'Wird geladen…', 'status.loadingResults': 'Ergebnisse werden geladen', 'status.noResults': 'Keine Ergebnisse',
  'status.noResultsFor': 'Keine Ergebnisse für „{query}“', 'status.noData': 'Keine Daten',
  'status.resultsCount': '{count, plural, =0 {Keine Ergebnisse} one {# Ergebnis} other {# Ergebnisse}}', 'status.error': 'Etwas ist schiefgelaufen',
  'status.typing': '{name} schreibt…', 'status.assistantTyping': 'Assistent schreibt', 'status.thinking': 'Denkt nach…', 'status.progress': 'Fortschritt',
  'status.offline': 'Du bist offline. Änderungen werden lokal gespeichert. Neuer Versuch in {seconds} s', 'status.better': '(besser)', 'status.worse': '(schlechter)',
  'status.deltaTitle': '{value} als im Vorzeitraum', 'status.higher': 'Höher', 'status.lower': 'Niedriger',
  'status.betterWord': 'Besser', 'status.worseWord': 'Schlechter',
  'date.today': 'Heute', 'date.yesterday': 'Gestern', 'date.tomorrow': 'Morgen', 'date.previousMonth': 'Vorheriger Monat', 'date.nextMonth': 'Nächster Monat', 'date.chooseDate': 'Datum wählen',
  'paging.pagination': 'Seitennavigation', 'paging.previousPage': 'Vorherige Seite', 'paging.nextPage': 'Nächste Seite', 'paging.page': 'Seite {page}',
  'paging.pageOf': 'Seite {page} von {total}', 'paging.rangeOf': '{from}–{to} von {total}', 'paging.rowsPerPage': 'Zeilen pro Seite',
  'field.showPassword': 'Passwort anzeigen', 'field.hidePassword': 'Passwort verbergen', 'field.swipeForMore': 'Wischen für mehr',
  'people.groupLabel': '{count, plural, one {# Person} other {# Personen}}: {names}',
  'feedback.notifications': 'Benachrichtigungen', 'feedback.dismissNotification': 'Benachrichtigung schließen', 'feedback.like': 'Gefällt mir, {count}',
  'feedback.cookieTitle': 'Wir verwenden Cookies', 'feedback.cookieBody': 'Notwendige Cookies halten die Website am Laufen. Andere helfen uns, sie zu verbessern.',
  'feedback.cookieConsent': 'Cookie-Einwilligung', 'feedback.saveChoices': 'Auswahl speichern', 'feedback.customise': 'Anpassen', 'feedback.rejectAll': 'Alle ablehnen', 'feedback.acceptAll': 'Alle akzeptieren',
  'theme.switchToLight': 'Zum hellen Design wechseln', 'theme.switchToDark': 'Zum dunklen Design wechseln', 'theme.appearance': 'Darstellung', 'theme.settings': 'Darstellungseinstellungen',
  'theme.mode': 'Modus', 'theme.light': 'Hell', 'theme.dark': 'Dunkel', 'theme.system': 'System', 'theme.theme': 'Design', 'theme.custom': 'Eigenes', 'theme.customHint': 'Deine Farben',
  'theme.variantStyle': '{theme}: {mode, select, dark {dunkler} other {heller}} Stil', 'theme.customise': 'Anpassen', 'theme.customEditing': 'Du bearbeitest dein eigenes Design',
  'theme.customCreates': 'Änderungen erstellen ein eigenes Design', 'theme.colourLabel': 'Farbe: {name}',
  'theme.colour.bg': 'Hintergrund', 'theme.colour.card': 'Oberfläche', 'theme.colour.fg': 'Text', 'theme.colour.primary': 'Primär', 'theme.colour.accent': 'Akzent',
  'theme.colour.ok': 'Erfolg', 'theme.colour.warn': 'Warnung', 'theme.colour.bad': 'Gefahr', 'theme.radius': 'Eckenradius', 'theme.font': 'Schrift', 'theme.copyCss': 'CSS kopieren',
  'theme.cssCopied': 'CSS-Variablen kopiert',
  'locale.language': 'Sprache', 'locale.direction': 'Richtung', 'locale.ltr': 'Links nach rechts', 'locale.rtl': 'Rechts nach links',
}

/**
 * Arabic UI strings for `<UIProvider locale="ar-EG" messages={UI_MESSAGES_AR}>` (direction becomes rtl from the locale).
 * Machine-drafted for 0.4, including the six Arabic plural forms: have a native speaker review before shipping to users.
 */
export const UI_MESSAGES_AR: UIMessages = {
  'common.close': 'إغلاق', 'common.cancel': 'إلغاء', 'common.confirm': 'تأكيد', 'common.done': 'تم', 'common.ok': 'حسنًا',
  'common.save': 'حفظ', 'common.saved': 'تم الحفظ', 'common.delete': 'حذف', 'common.edit': 'تعديل', 'common.editItem': 'تعديل {name}',
  'common.add': 'إضافة', 'common.remove': 'إزالة', 'common.removeItem': 'إزالة {name}', 'common.open': 'فتح', 'common.openItem': 'فتح {name}',
  'common.copy': 'نسخ', 'common.copied': 'تم النسخ', 'common.copyFailed': 'تعذّر النسخ', 'common.clipboardBlocked': 'الحافظة محظورة',
  'common.search': 'بحث', 'common.searchPlaceholder': 'بحث…', 'common.filter': 'تصفية', 'common.clear': 'مسح', 'common.clearAll': 'مسح الكل',
  'common.reset': 'إعادة تعيين', 'common.retry': 'إعادة المحاولة', 'common.retryNow': 'إعادة المحاولة الآن', 'common.undo': 'تراجع', 'common.redo': 'إعادة',
  'common.send': 'إرسال', 'common.sending': 'جارٍ الإرسال…', 'common.continue': 'متابعة', 'common.back': 'رجوع', 'common.previous': 'السابق', 'common.next': 'التالي',
  'common.more': 'المزيد', 'common.moreActions': 'إجراءات أخرى', 'common.moreCount': '{count} أخرى', 'common.showMore': 'عرض المزيد', 'common.showLess': 'عرض أقل',
  'common.expand': 'توسيع', 'common.collapse': 'طي', 'common.expandAll': 'توسيع الكل', 'common.collapseAll': 'طي الكل',
  'common.select': 'اختر…', 'common.selectAll': 'تحديد الكل',
  'common.selectedCount': '{count, plural, =0 {لم يُحدَّد شيء} one {عنصر واحد محدد} two {عنصران محددان} few {# عناصر محددة} many {# عنصرًا محددًا} other {# عنصر محدد}}',
  'common.dismiss': 'تجاهل', 'common.settings': 'الإعدادات', 'common.menu': 'القائمة', 'common.required': 'مطلوب', 'common.optional': 'اختياري',
  'common.play': 'تشغيل', 'common.pause': 'إيقاف مؤقت', 'common.zoomIn': 'تكبير', 'common.zoomOut': 'تصغير', 'common.approve': 'موافقة', 'common.reject': 'رفض',
  'common.upload': 'رفع', 'common.addFiles': 'إضافة ملفات', 'common.dropFiles': 'أفلت الملفات لإرفاقها',
  'status.loading': 'جارٍ التحميل', 'status.loadingEllipsis': 'جارٍ التحميل…', 'status.loadingResults': 'جارٍ تحميل النتائج', 'status.noResults': 'لا توجد نتائج',
  'status.noResultsFor': 'لا توجد نتائج لـ «{query}»', 'status.noData': 'لا توجد بيانات',
  'status.resultsCount': '{count, plural, =0 {لا توجد نتائج} one {نتيجة واحدة} two {نتيجتان} few {# نتائج} many {# نتيجة} other {# نتيجة}}', 'status.error': 'حدث خطأ ما',
  'status.typing': '{name} يكتب…', 'status.assistantTyping': 'المساعد يكتب', 'status.thinking': 'يفكر…', 'status.progress': 'التقدم',
  'status.offline': 'أنت غير متصل. تُحفظ التعديلات محليًا. إعادة المحاولة خلال {seconds} ث', 'status.better': '(أفضل)', 'status.worse': '(أسوأ)',
  'status.deltaTitle': '{value} مقارنة بالفترة السابقة', 'status.higher': 'أعلى', 'status.lower': 'أدنى',
  'status.betterWord': 'أفضل', 'status.worseWord': 'أسوأ',
  'date.today': 'اليوم', 'date.yesterday': 'أمس', 'date.tomorrow': 'غدًا', 'date.previousMonth': 'الشهر السابق', 'date.nextMonth': 'الشهر التالي', 'date.chooseDate': 'اختر تاريخًا',
  'paging.pagination': 'التنقل بين الصفحات', 'paging.previousPage': 'الصفحة السابقة', 'paging.nextPage': 'الصفحة التالية', 'paging.page': 'الصفحة {page}',
  'paging.pageOf': 'الصفحة {page} من {total}', 'paging.rangeOf': '{from}–{to} من {total}', 'paging.rowsPerPage': 'صفوف في كل صفحة',
  'field.showPassword': 'إظهار كلمة المرور', 'field.hidePassword': 'إخفاء كلمة المرور', 'field.swipeForMore': 'اسحب لعرض المزيد',
  'people.groupLabel': '{count, plural, one {شخص واحد} two {شخصان} few {# أشخاص} many {# شخصًا} other {# شخص}}: {names}',
  'feedback.notifications': 'الإشعارات', 'feedback.dismissNotification': 'إغلاق الإشعار', 'feedback.like': 'إعجاب، {count}',
  'feedback.cookieTitle': 'نستخدم ملفات تعريف الارتباط', 'feedback.cookieBody': 'ملفات تعريف الارتباط الأساسية تُبقي الموقع يعمل، والأخرى تساعدنا على تحسينه.',
  'feedback.cookieConsent': 'الموافقة على ملفات تعريف الارتباط', 'feedback.saveChoices': 'حفظ الاختيارات', 'feedback.customise': 'تخصيص', 'feedback.rejectAll': 'رفض الكل', 'feedback.acceptAll': 'قبول الكل',
  'theme.switchToLight': 'التبديل إلى المظهر الفاتح', 'theme.switchToDark': 'التبديل إلى المظهر الداكن', 'theme.appearance': 'المظهر', 'theme.settings': 'إعدادات المظهر',
  'theme.mode': 'الوضع', 'theme.light': 'فاتح', 'theme.dark': 'داكن', 'theme.system': 'النظام', 'theme.theme': 'السمة', 'theme.custom': 'مخصص', 'theme.customHint': 'ألوانك',
  'theme.variantStyle': 'نمط {theme} {mode, select, dark {الداكن} other {الفاتح}}', 'theme.customise': 'تخصيص', 'theme.customEditing': 'أنت تعدّل سمتك المخصصة',
  'theme.customCreates': 'التعديلات تُنشئ سمة مخصصة', 'theme.colourLabel': 'لون {name}',
  'theme.colour.bg': 'الخلفية', 'theme.colour.card': 'السطح', 'theme.colour.fg': 'النص', 'theme.colour.primary': 'الأساسي', 'theme.colour.accent': 'التمييز',
  'theme.colour.ok': 'نجاح', 'theme.colour.warn': 'تحذير', 'theme.colour.bad': 'خطر', 'theme.radius': 'نصف قطر الزوايا', 'theme.font': 'الخط', 'theme.copyCss': 'نسخ CSS',
  'theme.cssCopied': 'تم نسخ متغيرات CSS',
  'locale.language': 'اللغة', 'locale.direction': 'الاتجاه', 'locale.ltr': 'من اليسار إلى اليمين', 'locale.rtl': 'من اليمين إلى اليسار',
}
