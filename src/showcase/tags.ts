/* Tag vocabulary: the one list of tags for the showcase (card chips, sidebar facets, ⌘K, ?tags= links), the docs site
 * (sidebar groups and tag filter) and the registry build (dist-registry/index.json, r/*.json meta, llms.txt).
 *
 * Five facets: kind (what it is), area (where it lives in a UI), use case (the job it does), capability (how it behaves)
 * and status. Every tag has an id (used in URLs and JSON; never rename one without a redirect), a label, a one-line
 * description and synonyms, which search also matches ("dropdown" finds Select, "autocomplete" Combobox, "DAG" the lane
 * graph). TAG_CARDS tags every showcase card (by its <Spec title>) with 3–6 of them and names the registry items it
 * demonstrates; tests/unit/tags.test.ts fails when a card is untagged, a tag is unknown or a tag has no cards.
 *
 * Node scripts import this file directly (Node's type stripping), so it imports nothing and uses only erasable
 * TypeScript: no enums, namespaces or parameter properties. Top-level names start with tag/TAG_ (they share one
 * namespace with src/lib in dist-single/ui-with-examples.tsx). Labels are English data, like the demo content. */

/** The facets, in the order the sidebar, docs and llms.txt show them. */
export const TAG_FACETS = [
  { id: 'kind', label: 'Kind', desc: 'What it is: a component, a hook, a utility, a copy-in block, a chart, a diagram or a pattern.' },
  { id: 'area', label: 'Area', desc: 'Where it lives in an interface.' },
  { id: 'use', label: 'Use case', desc: 'The job it does in a product.' },
  { id: 'capability', label: 'Capability', desc: 'How it behaves: input methods, data size, live data, motion, languages.' },
  { id: 'status', label: 'Status', desc: 'How settled the API is.' },
] as const
export type TagFacet = (typeof TAG_FACETS)[number]['id']

/** One tag of the vocabulary. */
export type TagDef = { readonly id: string; readonly facet: TagFacet; readonly label: string; readonly desc: string; readonly synonyms: readonly string[] }

const tagDef = <I extends string, F extends TagFacet>(facet: F, id: I, label: string, desc: string, synonyms: readonly string[] = []) => ({ id, facet, label, desc, synonyms })

/** Every tag. Ids are lowercase kebab-case and unique across facets. */
export const TAGS = [
  // kind
  tagDef('kind', 'component', 'Component', 'A React component you render.', ['widget', 'control']),
  tagDef('kind', 'hook', 'Hook', 'A React hook that drives your own markup.', ['use', 'headless']),
  tagDef('kind', 'utility', 'Utility', 'Helpers, strings and functions with no UI of their own.', ['helper', 'function', 'lib']),
  tagDef('kind', 'block', 'Block', 'A copy-in page section built from the components.', ['template', 'section', 'page']),
  tagDef('kind', 'chart', 'Chart', 'A plot of numbers on axes or areas.', ['graph', 'plot', 'visualisation', 'visualization', 'dataviz']),
  tagDef('kind', 'diagram', 'Diagram', 'Boxes, lines, maps and timelines that show structure or flow.', ['canvas', 'graph', 'map', 'visualisation', 'visualization']),
  tagDef('kind', 'pattern', 'Pattern', 'Several components composed into a recipe.', ['recipe', 'composition', 'example']),
  // area
  tagDef('area', 'foundation', 'Foundation', 'Provider, slots, locale and hooks the other components build on.', ['setup', 'provider', 'core', 'primitives']),
  tagDef('area', 'actions', 'Actions', 'Buttons, menus and confirmations that do something.', ['buttons', 'button', 'call to action', 'CTA', 'menu']),
  tagDef('area', 'inputs', 'Inputs', 'Single controls that take a value.', ['user input', 'field', 'control', 'picker', 'entry']),
  tagDef('area', 'forms', 'Forms', 'Fields composed into forms: labels, validation, submission.', ['form', 'validation', 'fields', 'data entry']),
  tagDef('area', 'navigation', 'Navigation', 'Moving between pages, sections and views.', ['nav', 'menu', 'routing', 'wayfinding']),
  tagDef('area', 'overlays', 'Overlays', 'Layers above the page: dialogs, sheets, popovers, tooltips.', ['overlay', 'popup', 'layer', 'floating']),
  tagDef('area', 'feedback', 'Feedback', 'Telling people what happened and what is happening.', ['status', 'messages', 'loading', 'errors']),
  tagDef('area', 'data', 'Data display', 'Tables, lists, stats and viewers for records.', ['data display', 'table', 'list', 'records']),
  tagDef('area', 'layout', 'Layout', 'Boards, panes, trees and calendars that arrange content.', ['structure', 'arrangement', 'panels']),
  tagDef('area', 'charts', 'Charts', 'Plots of numbers.', ['chart', 'graphs', 'data visualisation', 'data visualization', 'dataviz', 'plots']),
  tagDef('area', 'diagrams', 'Diagrams and maps', 'Flows, graphs, timelines, maps and globes.', ['diagram', 'maps', 'graphs', 'flowchart', 'visualisation']),
  tagDef('area', 'media', 'Media', 'Video, audio and images.', ['images', 'video', 'audio', 'photos', 'player']),
  tagDef('area', 'collaboration', 'Collaboration', 'Several people working on the same thing.', ['collab', 'multiplayer', 'team', 'together']),
  tagDef('area', 'ai', 'AI', 'Chat, agents and model output.', ['LLM', 'artificial intelligence', 'assistant', 'GPT', 'Claude', 'copilot']),
  tagDef('area', 'code', 'Code', 'Showing, diffing and running code.', ['developer', 'source', 'syntax', 'programming']),
  tagDef('area', 'motion', 'Motion', 'Springs, transitions and moments of delight.', ['animation', 'springs', 'transitions', 'delight']),
  tagDef('area', 'theming', 'Theming', 'Colours, palettes and design tokens.', ['theme', 'colours', 'colors', 'design tokens', 'dark mode', 'branding']),
  tagDef('area', 'pages', 'Pages and blocks', 'Whole page sections to copy in and adapt.', ['templates', 'blocks', 'screens', 'sections']),
  // use case
  tagDef('use', 'search', 'Search', 'Finding a thing by typing.', ['find', 'lookup', 'query', 'typeahead', 'autocomplete']),
  tagDef('use', 'filtering', 'Filtering', 'Narrowing a list down by criteria.', ['filter', 'filters', 'facets', 'refine', 'narrow']),
  tagDef('use', 'scheduling', 'Scheduling and dates', 'Dates, times, calendars and bookings.', ['calendar', 'booking', 'appointments', 'dates', 'availability', 'meetings', 'time']),
  tagDef('use', 'onboarding', 'Onboarding', 'First run, setup and getting started.', ['first run', 'walkthrough', 'setup', 'activation', 'getting started', 'welcome']),
  tagDef('use', 'checkout', 'Checkout and payments', 'Prices, quantities, payment and plans.', ['payments', 'commerce', 'e-commerce', 'cart', 'billing', 'purchase', 'shop']),
  tagDef('use', 'dashboards', 'Dashboards', 'KPIs and reports at a glance.', ['KPI', 'metrics', 'reports', 'analytics', 'admin', 'BI']),
  tagDef('use', 'monitoring', 'Monitoring', 'Watching systems and activity as they run.', ['observability', 'tracing', 'logs', 'health', 'telemetry', 'status page', 'activity']),
  tagDef('use', 'agents', 'Agents', 'AI agents: plans, tools, approvals and runs.', ['agentic', 'orchestration', 'tools', 'tool calls', 'autonomous', 'MCP']),
  tagDef('use', 'chat', 'Chat and messaging', 'Conversations between people or with a model.', ['messaging', 'conversation', 'messages', 'inbox', 'chatbot', 'DM']),
  tagDef('use', 'editing', 'Writing and editing', 'Composing and changing text and documents.', ['editor', 'writing', 'rich text', 'documents', 'WYSIWYG', 'content']),
  tagDef('use', 'uploads', 'Uploads', 'Getting files and images in.', ['upload', 'files', 'attachments', 'import', 'dropzone']),
  tagDef('use', 'auth', 'Sign-in and security', 'Passwords, codes and identity.', ['login', 'sign in', 'signup', 'password', 'OTP', '2FA', 'security', 'authentication']),
  tagDef('use', 'settings', 'Settings', 'Preferences and account options.', ['preferences', 'account', 'configuration', 'options']),
  tagDef('use', 'notifications', 'Notifications', 'Telling people about events: toasts, banners, inboxes.', ['notification', 'alerts', 'inbox', 'announcements', 'bell']),
  tagDef('use', 'planning', 'Planning and tasks', 'Projects, tasks, roadmaps and boards.', ['project management', 'tasks', 'roadmap', 'todo', 'workflow board']),
  tagDef('use', 'statistics', 'Statistics', 'Distributions, uncertainty and experiments.', ['data science', 'distribution', 'uncertainty', 'experiments', 'A/B test', 'regression', 'confidence interval']),
  tagDef('use', 'finance', 'Finance', 'Money, markets and budgets.', ['money', 'trading', 'markets', 'stocks', 'P&L', 'budget', 'currency']),
  tagDef('use', 'marketing', 'Marketing', 'Landing pages, pricing and announcements.', ['landing page', 'growth', 'conversion', 'promotion', 'website']),
  tagDef('use', 'review', 'Review and approval', 'Checking, accepting or rejecting work, including a human in the loop.', ['approval', 'human in the loop', 'accept or reject', 'moderation', 'trust', 'reviews']),
  tagDef('use', 'devtools', 'Developer tools', 'Docs, snippets, consoles and inspectors for developers.', ['developer', 'docs', 'documentation', 'API', 'debugging', 'CLI', 'IDE', 'devtools']),
  tagDef('use', 'hierarchy', 'Trees and hierarchies', 'Nested structures: files, folders, org charts, breadcrumbs.', ['tree', 'files', 'folders', 'file explorer', 'nested', 'outline']),
  tagDef('use', 'workflows', 'Workflows and automation', 'Processes, pipelines and state machines.', ['workflow', 'automation', 'pipeline', 'process', 'ETL', 'state machine', 'lifecycle']),
  tagDef('use', 'people', 'People and social', 'Profiles, teams, presence and reactions.', ['social', 'profile', 'team', 'users', 'reactions', 'likes', 'community']),
  tagDef('use', 'geo', 'Maps and geo', 'Countries, regions, locations and routes.', ['map', 'maps', 'geography', 'countries', 'locations', 'routes', 'world']),
  tagDef('use', 'comparison', 'Comparison', 'Putting options or values side by side.', ['compare', 'versus', 'vs', 'benchmark', 'side by side']),
  tagDef('use', 'version-control', 'Version control', 'Changes, commits, branches and history.', ['git', 'diff', 'commits', 'branches', 'history', 'changes']),
  tagDef('use', 'legal', 'Legal and consent', 'Consent, privacy and signatures.', ['privacy', 'GDPR', 'cookies', 'consent', 'contracts', 'compliance']),
  tagDef('use', 'help', 'Help and guidance', 'Hints, tours, FAQs and shortcut sheets.', ['hints', 'tips', 'guidance', 'FAQ', 'documentation']),
  tagDef('use', 'destructive-actions', 'Destructive actions', 'Confirming, undoing and guarding deletes.', ['delete', 'confirm', 'confirmation', 'undo', 'danger', 'irreversible']),
  // capability
  tagDef('capability', 'keyboard', 'Keyboard', 'Full keyboard support beyond Tab: arrows, shortcuts, typeahead.', ['keyboard navigation', 'shortcuts', 'hotkeys', 'arrow keys', 'roving focus']),
  tagDef('capability', 'touch', 'Touch and gestures', 'Built for fingers: swipe, drag, pinch, long press, bigger targets.', ['mobile', 'gestures', 'swipe', 'pinch', 'long press', 'tap']),
  tagDef('capability', 'virtualised', 'Virtualised', 'Renders only what is on screen, so huge lists stay fast.', ['virtualized', 'virtual scroll', 'windowing', 'large data', 'performance', '10k', '50k']),
  tagDef('capability', 'streaming', 'Streaming', 'Shows output as it arrives, token by token or line by line.', ['stream', 'tokens', 'SSE', 'incremental', 'live output']),
  tagDef('capability', 'async', 'Async', 'Loads or saves through promises, with loading and error states.', ['loading', 'fetch', 'promise', 'debounce', 'remote', 'pending', 'promise toast']),
  tagDef('capability', 'drag-and-drop', 'Drag and drop', 'Move, reorder or drop things with a pointer or finger.', ['drag', 'drop', 'dnd', 'reorder', 'sortable', 'draggable']),
  tagDef('capability', 'i18n', 'i18n and RTL', 'Locale-aware formats, translations and right-to-left layout.', ['internationalisation', 'internationalization', 'localisation', 'localization', 'locale', 'RTL', 'right to left', 'translation', 'time zone']),
  tagDef('capability', 'animated', 'Animated', 'Motion that explains a change (and respects reduced motion).', ['animation', 'motion', 'spring', 'transition']),
  tagDef('capability', 'accessible', 'Accessibility pattern', 'Shows an accessibility technique worth copying: announcements, no colour alone, focus handling.', ['a11y', 'accessibility', 'screen reader', 'ARIA', 'WCAG', 'data table', 'accessible chart']),
  tagDef('capability', 'server-mode', 'Server mode', 'The server sorts, filters, pages or validates.', ['server-side', 'server side', 'pagination', 'remote data', 'server actions', 'API']),
  tagDef('capability', 'real-time', 'Real-time', 'Updates live from a feed or other people.', ['realtime', 'live', 'websocket', 'ticks', 'presence', 'push']),
  tagDef('capability', 'composable', 'Composable parts', 'Built from parts (Root, Trigger, Content) and asChild.', ['compound components', 'asChild', 'slots', 'parts', 'headless', 'Radix']),
  // status
  tagDef('status', 'new', 'New', 'Added or rebuilt in the latest minor release (0.8) or the one in progress.', ['latest', 'recent', "what's new", 'release']),
  tagDef('status', 'experimental', 'Experimental', 'Usable, but the API may still change in a minor release.', ['beta', 'preview', 'unstable', 'alpha']),
] as const satisfies readonly TagDef[]

export type TagId = (typeof TAGS)[number]['id']
export type TagKind = Extract<(typeof TAGS)[number], { facet: 'kind' }>['id']
export type TagArea = Extract<(typeof TAGS)[number], { facet: 'area' }>['id']

export const TAG_BY_ID: Readonly<Record<TagId, TagDef>> = Object.fromEntries(TAGS.map(t => [t.id, t])) as Record<TagId, TagDef>
export const tagIsId = (s: string): s is TagId => Object.prototype.hasOwnProperty.call(TAG_BY_ID, s)
export const tagFacetOf = (id: TagId): TagFacet => TAG_BY_ID[id].facet
export const tagsOfFacet = (facet: TagFacet): TagDef[] => TAGS.filter(t => t.facet === facet)
const TAG_FACET_RANK = Object.fromEntries(TAG_FACETS.map((f, i) => [f.id, i])) as Record<TagFacet, number>

/* Cards ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** A showcase card: what kind of thing it shows, 3–6 tags (at least one area), the registry items it demonstrates
 * (dist-registry/index.json names; the first is the main one) and extra search words (`aka`). */
export type TagCard = { readonly kind: TagKind; readonly tags: readonly TagId[]; readonly items: readonly string[]; readonly aka?: readonly string[] }

const tagCard = (kind: TagKind, tags: readonly TagId[], items: readonly string[], aka?: readonly string[]): TagCard => ({ kind, tags, items, aka })
const C = 'component', P = 'pattern'

/** Every showcase card by its <Spec title>. Order: area(s), use cases, capabilities, status. */
export const TAG_CARDS: Readonly<Record<string, TagCard>> = {
  // buttons
  'Variants': tagCard(C, ['actions', 'theming', 'touch'], ['button'], ['button', 'icon button', 'primary', 'secondary', 'ghost', 'danger', 'sizes']),
  'Loading to success': tagCard(C, ['actions', 'feedback', 'async', 'animated'], ['async-button'], ['submit', 'loading button', 'spinner', 'success state']),
  'Like with burst': tagCard(C, ['actions', 'motion', 'people', 'animated'], ['like-button', 'copy-button'], ['heart', 'favourite', 'favorite', 'reaction', 'copy']),
  // motion
  'Motion playground': tagCard('utility', ['motion', 'theming', 'animated'], ['motion'], ['spring', 'easing', 'bounce', 'duration', 'design tokens']),
  // inputs
  'Text field with validation': tagCard(C, ['inputs', 'forms', 'accessible'], ['input', 'form'], ['text input', 'text field', 'error message', 'helper text']),
  'Switch': tagCard(C, ['inputs', 'settings', 'animated'], ['switch'], ['toggle', 'on off', 'toggle switch']),
  'Checkbox and radio': tagCard(C, ['inputs', 'forms', 'keyboard'], ['checkbox', 'radio-group'], ['checkbox', 'radio', 'radio group', 'indeterminate', 'options']),
  'One-time code': tagCard(C, ['inputs', 'auth', 'keyboard'], ['otp-input'], ['OTP', 'verification code', 'PIN', 'two-factor', 'paste code']),
  'Segmented control': tagCard(C, ['inputs', 'filtering', 'keyboard', 'animated'], ['segmented-control'], ['view switcher', 'button group', 'toggle buttons']),
  'Number stepper': tagCard(C, ['inputs', 'checkout', 'keyboard'], ['number-stepper'], ['quantity', 'spinbutton', 'increment', 'counter', 'number input']),
  'Slider': tagCard(C, ['inputs', 'settings', 'touch', 'keyboard'], ['slider'], ['range input', 'volume', 'track', 'thumb']),
  'Slider with magnets': tagCard(C, ['inputs', 'settings', 'touch', 'animated'], ['slider', 'magnet-marks', 'magnet-bubble'], ['snap', 'snapping', 'detents', 'haptics', 'magnets', 'ticks']),
  'Rating': tagCard(C, ['inputs', 'review', 'keyboard'], ['rating'], ['stars', 'star rating', 'score', 'reviews']),
  'Tag input': tagCard(C, ['inputs', 'forms', 'filtering', 'keyboard'], ['tag-input'], ['tags', 'chips', 'keywords', 'labels', 'token input']),
  'Date picker dropdown': tagCard(C, ['inputs', 'forms', 'scheduling', 'keyboard'], ['date-picker'], ['calendar', 'date input', 'datepicker']),
  'Calendar constraints': tagCard(C, ['inputs', 'scheduling', 'accessible'], ['calendar', 'date-picker'], ['availability', 'booking', 'disabled dates', 'min max', 'unavailable']),
  'Date range picker': tagCard(C, ['inputs', 'scheduling', 'filtering', 'dashboards'], ['date-range-picker'], ['range', 'presets', 'from to', 'last 30 days']),
  'Typed dates in any locale': tagCard(C, ['inputs', 'scheduling', 'keyboard', 'i18n'], ['date-field', 'time-field', 'calendar'], ['date field', 'segments', 'typing', 'locale formats']),
  'Time picker': tagCard(C, ['inputs', 'scheduling', 'keyboard'], ['time-picker', 'time-field'], ['clock', 'hours', 'minutes', 'time input']),
  'Date and time with a time zone': tagCard(C, ['inputs', 'scheduling', 'i18n'], ['date-time-picker', 'time-zone-picker'], ['datetime', 'timezone', 'meeting time', 'UTC']),
  'Month and year': tagCard(C, ['inputs', 'scheduling', 'checkout'], ['month-picker', 'year-picker'], ['month picker', 'year picker', 'billing period', 'card expiry']),
  'Combobox': tagCard(C, ['inputs', 'search', 'keyboard'], ['combobox'], ['autocomplete', 'typeahead', 'searchable select', 'select with search']),
  'Multi-select': tagCard(C, ['inputs', 'filtering', 'keyboard'], ['multi-select'], ['multiple select', 'select many', 'chips', 'tags']),
  'Select': tagCard(C, ['inputs', 'forms', 'keyboard'], ['select'], ['dropdown', 'picker', 'listbox', 'option list', 'native select']),
  'Textarea': tagCard(C, ['inputs', 'forms', 'editing'], ['textarea'], ['multiline', 'long text', 'auto grow', 'bio', 'character count']),
  'Password': tagCard(C, ['inputs', 'auth', 'accessible'], ['password-input'], ['password strength', 'show password', 'reveal', 'signup']),
  'Colour picker': tagCard(C, ['inputs', 'theming', 'touch'], ['color-picker'], ['color picker', 'colour', 'color', 'hex', 'swatches', 'hue', 'eyedropper']),
  'File upload': tagCard(C, ['inputs', 'uploads', 'drag-and-drop'], ['file-upload'], ['dropzone', 'file input', 'attachments', 'browse files']),
  'Range slider': tagCard(C, ['inputs', 'filtering', 'checkout', 'touch'], ['slider'], ['price range', 'min max', 'two thumbs', 'dual slider', 'price filter']),
  'Phone number': tagCard(C, ['inputs', 'forms', 'i18n'], ['phone-input'], ['tel', 'telephone', 'country code', 'international', 'E.164']),
  'Currency input': tagCard(C, ['inputs', 'checkout', 'finance', 'i18n'], ['currency-input'], ['money', 'amount', 'price', 'money input']),
  // forms
  'Rich text editor': tagCard(C, ['forms', 'editing', 'keyboard'], ['rich-text-editor'], ['WYSIWYG', 'formatting', 'bold italic', 'contenteditable', 'document editor']),
  'Signature pad': tagCard(C, ['forms', 'legal', 'touch'], ['signature-pad'], ['sign', 'e-signature', 'draw', 'signature']),
  'Mentions and commands': tagCard(C, ['forms', 'chat', 'collaboration', 'keyboard'], ['mentions-input'], ['@mentions', 'mention', 'slash commands', 'autocomplete']),
  'Address autocomplete': tagCard(C, ['forms', 'checkout', 'search', 'async'], ['address-autocomplete'], ['address', 'places', 'shipping address', 'autocomplete', 'postcode']),
  'Emoji picker': tagCard(C, ['forms', 'chat', 'people'], ['emoji-picker', 'emoji-input'], ['emoji', 'smileys', 'reactions', 'emoticons']),
  'Form submission': tagCard(P, ['forms', 'inputs', 'async', 'accessible', 'server-mode'], ['form', 'input', 'combobox', 'date-picker', 'multi-select', 'phone-input', 'tag-input', 'rating', 'checkbox'], ['validation', 'server actions', 'FormData', 'useActionState', 'submit']),
  'Async combobox': tagCard(C, ['forms', 'search', 'async'], ['combobox'], ['autocomplete', 'typeahead', 'remote search', 'debounce', 'API search']),
  'Async multi-select': tagCard(C, ['forms', 'search', 'filtering', 'async'], ['multi-select'], ['remote options', 'tags', 'chips', 'multi select']),
  'Form with unsaved changes': tagCard(P, ['forms', 'settings', 'editing'], ['unsaved-changes-bar', 'form'], ['dirty state', 'save bar', 'discard changes', 'draft', 'leave page']),
  // navigation
  'Tabs': tagCard(C, ['navigation', 'keyboard', 'animated'], ['tabs'], ['tab bar', 'tablist', 'view switcher', 'sections']),
  'Tabs · vertical and overflow': tagCard(C, ['navigation', 'keyboard', 'touch', 'composable'], ['tabs'], ['vertical tabs', 'overflow', 'scrolling tabs', 'more tabs']),
  'Toolbar and toggle group': tagCard(C, ['navigation', 'actions', 'editing', 'keyboard'], ['toolbar', 'toggle-group', 'toggle'], ['formatting bar', 'toggle', 'button group', 'pressed']),
  'Links as buttons (asChild)': tagCard(P, ['navigation', 'foundation', 'composable'], ['slot', 'button'], ['asChild', 'Slot', 'router link', 'Next.js Link', 'anchor']),
  'Wizard stepper': tagCard(C, ['navigation', 'onboarding', 'forms'], ['wizard', 'steps'], ['stepper', 'multi-step form', 'steps', 'progress steps']),
  'Breadcrumbs and pagination': tagCard(C, ['navigation', 'hierarchy', 'accessible'], ['breadcrumbs', 'pagination'], ['breadcrumb', 'pager', 'paging', 'page numbers']),
  'Collapsible sidebar': tagCard(C, ['navigation', 'layout', 'keyboard'], ['collapsible-sidebar', 'nav-list'], ['sidebar', 'app shell', 'nav rail', 'side navigation']),
  'Mobile tab bar': tagCard(C, ['navigation', 'touch', 'animated'], ['mobile-tab-bar'], ['bottom navigation', 'bottom tabs', 'tab bar', 'app shell']),
  'Mega menu': tagCard(C, ['navigation', 'marketing', 'keyboard'], ['mega-menu'], ['header navigation', 'site navigation', 'flyout', 'dropdown navigation']),
  'Context menu': tagCard(C, ['actions', 'hierarchy', 'touch', 'keyboard'], ['context-menu'], ['right click', 'long press', 'file actions', 'menu']),
  'Context menu · composable': tagCard(C, ['actions', 'keyboard', 'composable'], ['context-menu'], ['right click', 'submenu', 'radio items', 'checkbox items']),
  // feedback
  'Alerts': tagCard(C, ['feedback', 'notifications', 'accessible'], ['alert'], ['callout', 'inline alert', 'error message', 'warning', 'banner']),
  'Toasts': tagCard(C, ['feedback', 'notifications', 'destructive-actions', 'async', 'animated'], ['toast'], ['snackbar', 'notification', 'undo', 'sonner', 'useToast', 'toast.promise', 'promise toast', 'loading toast', 'toast position', 'dedupe', 'update toast']),
  'Progress': tagCard(C, ['feedback', 'uploads', 'animated'], ['progress'], ['progress bar', 'progress ring', 'percent', 'loading bar']),
  'Skeleton loading': tagCard(C, ['feedback', 'async', 'animated'], ['skeleton'], ['placeholder', 'shimmer', 'loading state', 'ghost']),
  'Empty state': tagCard(C, ['feedback', 'onboarding', 'animated'], ['empty-state'], ['zero state', 'no data', 'no results', 'blank slate']),
  'Badges and status': tagCard(C, ['feedback', 'monitoring', 'accessible'], ['badge', 'status-icon', 'spinner'], ['badge', 'pill', 'status dot', 'label', 'tag', 'live']),
  'Celebration': tagCard('utility', ['feedback', 'motion', 'animated'], ['confetti'], ['confetti', 'milestone', 'success', 'party']),
  'Upgrade prompt': tagCard(P, ['feedback', 'marketing', 'checkout'], ['progress', 'toast'], ['paywall', 'usage limit', 'upsell', 'plans']),
  'Cookie consent': tagCard('block', ['feedback', 'legal', 'settings'], ['cookie-consent'], ['cookies', 'GDPR', 'privacy banner', 'consent banner']),
  'Offline indicator': tagCard(C, ['feedback', 'monitoring', 'async'], ['offline-indicator'], ['offline', 'connectivity', 'network status', 'retry', 'PWA']),
  // overlays
  'Dropdown menu': tagCard(C, ['overlays', 'actions', 'keyboard'], ['dropdown-menu'], ['menu', 'more actions', 'kebab', 'overflow menu', 'dropdown']),
  'Modal': tagCard(C, ['overlays', 'destructive-actions', 'accessible'], ['dialog'], ['dialog', 'popup', 'focus trap', 'modal window']),
  'Sheet / drawer': tagCard(C, ['overlays', 'filtering', 'touch'], ['sheet'], ['drawer', 'side panel', 'bottom sheet', 'slide over', 'off-canvas']),
  'Popover': tagCard(C, ['overlays', 'collaboration', 'keyboard'], ['popover'], ['popup', 'share', 'flyout', 'floating panel']),
  'Hover card': tagCard(C, ['overlays', 'people', 'touch'], ['hover-card'], ['profile preview', 'hover preview', 'user card', 'peek']),
  'Onboarding tour': tagCard(C, ['overlays', 'onboarding', 'help'], ['tour'], ['walkthrough', 'product tour', 'coach marks', 'spotlight']),
  'Tooltip': tagCard(C, ['overlays', 'help', 'touch', 'accessible'], ['tooltip'], ['hint', 'tip', 'info', 'title']),
  'Command palette': tagCard(C, ['overlays', 'search', 'keyboard'], ['command-palette'], ['⌘K', 'cmd k', 'ctrl k', 'spotlight', 'launcher', 'command menu']),
  'Command palette · pages and async': tagCard(C, ['overlays', 'search', 'keyboard', 'async', 'virtualised'], ['command-palette'], ['nested pages', 'command menu', 'remote results', 'recent commands']),
  'Alert dialog': tagCard(C, ['overlays', 'destructive-actions', 'async'], ['alert-dialog'], ['confirm', 'are you sure', 'delete confirmation', 'alertdialog']),
  'Hold to confirm': tagCard(C, ['actions', 'destructive-actions', 'touch', 'accessible'], ['hold-to-confirm'], ['press and hold', 'long press', 'safety', 'delete']),
  'Notification centre': tagCard(C, ['overlays', 'notifications', 'collaboration'], ['notification-bell'], ['notification center', 'inbox', 'bell', 'activity feed', 'unread']),
  'Announcement banner': tagCard(C, ['feedback', 'marketing', 'notifications'], ['banner'], ['announcement bar', 'top bar', 'news', 'promo banner']),
  'Composable overlays': tagCard(P, ['overlays', 'accessible', 'composable'], ['dialog', 'sheet', 'popover', 'tooltip', 'hover-card', 'alert-dialog'], ['asChild', 'compound components', 'Radix-style', 'parts', 'Trigger', 'Content']),
  'Inline edit': tagCard(C, ['inputs', 'editing', 'keyboard'], ['inline-edit'], ['click to edit', 'editable text', 'edit in place']),
  // data
  'Stat cards': tagCard(C, ['data', 'dashboards', 'animated'], ['stat', 'animated-number'], ['KPI', 'metrics', 'stat', 'numbers', 'delta']),
  'Sortable table': tagCard(C, ['data', 'dashboards', 'keyboard', 'accessible'], ['data-table'], ['table', 'sort', 'columns', 'aria-sort']),
  'Accordion': tagCard(C, ['data', 'help', 'animated'], ['accordion'], ['FAQ', 'disclosure', 'collapse', 'expand', 'details']),
  'Accordion · composable': tagCard(C, ['data', 'help', 'keyboard', 'composable'], ['accordion'], ['FAQ', 'disclosure', 'compound components']),
  'Animated list': tagCard(C, ['data', 'planning', 'animated'], ['task-list'], ['todo', 'task list', 'checklist', 'enter exit animation', 'add remove']),
  'Avatars and presence': tagCard(C, ['data', 'people', 'collaboration'], ['avatar'], ['avatar stack', 'initials', 'facepile', 'status dot', 'presence']),
  'Data grid': tagCard(C, ['data', 'filtering', 'search', 'keyboard'], ['data-grid'], ['spreadsheet', 'table', 'grid', 'grouping', 'admin', 'pinned columns', 'query builder']),
  'Data grid · 50k rows': tagCard(C, ['data', 'dashboards', 'keyboard', 'virtualised'], ['data-grid'], ['performance', 'large data', 'spreadsheet', '50,000 rows']),
  'Data grid · server mode': tagCard(C, ['data', 'filtering', 'async', 'server-mode'], ['data-grid'], ['pagination', 'remote data', 'server-side sorting', 'API']),
  'Date picker': tagCard(C, ['inputs', 'scheduling', 'keyboard'], ['inline-date-picker', 'calendar'], ['calendar', 'inline calendar', 'date range', 'month view']),
  'JSON viewer': tagCard(C, ['data', 'devtools', 'keyboard'], ['json-viewer'], ['JSON', 'tree', 'API response', 'inspector', 'object viewer']),
  'Keyboard shortcuts': tagCard(C, ['data', 'help', 'keyboard'], ['shortcut-sheet', 'kbd'], ['hotkeys', 'cheat sheet', 'kbd', 'key bindings']),
  // layout
  'Kanban board': tagCard(C, ['layout', 'planning', 'drag-and-drop', 'touch'], ['kanban'], ['board', 'trello', 'columns', 'cards', 'tasks']),
  'Sortable list': tagCard(C, ['layout', 'planning', 'drag-and-drop', 'keyboard', 'touch'], ['sortable-list'], ['reorder', 'drag to sort', 'priorities', 'ranking']),
  'Tree view': tagCard(C, ['layout', 'hierarchy', 'keyboard'], ['tree-view'], ['file tree', 'explorer', 'folders', 'outline', 'treeview']),
  'Tree view · 10k nodes': tagCard(C, ['layout', 'hierarchy', 'virtualised'], ['tree-view'], ['file tree', 'large tree', 'performance', '10,000 nodes']),
  'Activity timeline': tagCard(C, ['data', 'collaboration', 'monitoring'], ['timeline'], ['audit log', 'history', 'activity feed', 'events']),
  'Split panes': tagCard(C, ['layout', 'devtools', 'keyboard', 'touch'], ['split-pane'], ['resizable', 'splitter', 'IDE', 'panels', 'resizer']),
  'Calendar scheduler': tagCard(C, ['layout', 'scheduling', 'drag-and-drop', 'i18n'], ['scheduler'], ['calendar', 'week view', 'events', 'booking', 'meetings']),
  'Org chart': tagCard('diagram', ['diagrams', 'people', 'hierarchy'], ['org-chart'], ['organisation chart', 'organization chart', 'reporting lines', 'team', 'HR']),
  // collaboration
  'Comments and threads': tagCard(C, ['collaboration', 'review', 'editing'], ['anchored-comments', 'comment-thread'], ['comments', 'annotations', 'replies', 'mentions', 'resolve']),
  'Live presence': tagCard(C, ['collaboration', 'people', 'real-time'], ['live-presence'], ['multiplayer', 'cursors', 'who is here', 'avatars']),
  'Chat inbox': tagCard(C, ['collaboration', 'chat', 'people'], ['chat-inbox'], ['messaging', 'support inbox', 'conversations', 'DM']),
  // pages
  'Pricing table': tagCard('block', ['pages', 'marketing', 'checkout'], ['pricing-table'], ['plans', 'tiers', 'pricing page', 'monthly yearly']),
  'Checkout': tagCard('block', ['pages', 'forms', 'checkout'], ['checkout'], ['cart', 'payment form', 'order summary', 'card details']),
  'Settings page': tagCard('block', ['pages', 'forms', 'settings'], ['settings-page'], ['account settings', 'preferences page']),
  'Profile': tagCard('block', ['pages', 'people', 'settings'], ['profile-card'], ['user profile', 'bio', 'account', 'profile card']),
  'Onboarding checklist': tagCard('block', ['pages', 'onboarding', 'animated'], ['onboarding-checklist'], ['setup checklist', 'getting started', 'activation', 'progress']),
  // charts
  'Line with forecast band': tagCard('chart', ['charts', 'statistics', 'dashboards', 'keyboard', 'accessible'], ['chart'], ['line chart', 'time series', 'forecast', 'trend', 'prediction interval', 'chart export', 'download PNG', 'SVG', 'CSV', 'data table', 'accessible chart']),
  'Bar': tagCard('chart', ['charts', 'comparison', 'dashboards', 'keyboard', 'accessible'], ['chart'], ['bar chart', 'column chart', 'grouped bars', 'stacked bars', 'chart export', 'download PNG', 'SVG', 'CSV', 'data table', 'accessible chart']),
  'Doughnut': tagCard('chart', ['charts', 'comparison', 'dashboards', 'accessible'], ['donut-chart'], ['donut', 'pie chart', 'part to whole', 'share', 'chart export', 'download PNG', 'SVG', 'CSV', 'data table', 'accessible chart']),
  'Stacked area': tagCard('chart', ['charts', 'dashboards', 'animated'], ['chart'], ['area chart', 'composition', 'time series', 'stacked']),
  'Radar': tagCard('chart', ['charts', 'comparison', 'statistics'], ['radar-chart'], ['spider chart', 'web chart', 'skills', 'profile']),
  'Scatter': tagCard('chart', ['charts', 'statistics', 'comparison', 'accessible'], ['scatter-chart'], ['scatter plot', 'correlation', 'x y', 'points', 'chart export', 'download PNG', 'SVG', 'CSV', 'data table', 'accessible chart']),
  'Sparkline tile': tagCard('chart', ['charts', 'dashboards', 'monitoring'], ['spark-tile'], ['KPI tile', 'sparkline', 'stat tile', 'trend']),
  'Waterfall': tagCard('chart', ['charts', 'finance', 'dashboards'], ['chart'], ['bridge chart', 'P&L', 'variance', 'waterfall chart']),
  'Combo bar + line': tagCard('chart', ['charts', 'comparison', 'dashboards'], ['chart'], ['dual axis', 'combo chart', 'mixed chart', 'bar and line']),
  'Histogram': tagCard('chart', ['charts', 'statistics', 'dashboards'], ['chart'], ['distribution', 'bins', 'frequency']),
  'Bubble': tagCard('chart', ['charts', 'statistics', 'finance'], ['scatter-chart'], ['bubble chart', 'three variables', 'portfolio', 'size encoding']),
  'Funnel': tagCard('chart', ['charts', 'marketing', 'dashboards'], ['funnel-chart'], ['conversion funnel', 'drop-off', 'pipeline', 'stages']),
  'Gauge': tagCard('chart', ['charts', 'dashboards', 'monitoring', 'animated'], ['gauge'], ['meter', 'dial', 'score', 'target', 'speedometer']),
  'Candlestick': tagCard('chart', ['charts', 'finance', 'monitoring', 'real-time'], ['chart', 'ticker-table', 'spark-chart'], ['OHLC', 'stocks', 'trading', 'ticker', 'markets']),
  'Heatmap': tagCard('chart', ['charts', 'dashboards', 'monitoring'], ['heatmap'], ['matrix', 'grid heatmap', 'activity', 'patterns', 'punch card']),
  'Calendar heatmap': tagCard('chart', ['charts', 'dashboards', 'monitoring', 'scheduling'], ['calendar-heatmap'], ['contributions', 'streaks', 'activity calendar', 'GitHub graph']),
  'Bullet': tagCard('chart', ['charts', 'dashboards', 'monitoring'], ['bullet-chart'], ['bullet chart', 'target', 'KPI', 'progress to goal']),
  'Bar list': tagCard('chart', ['charts', 'dashboards', 'keyboard', 'i18n'], ['bar-list'], ['top list', 'ranking', 'leaderboard', 'horizontal bars', 'top pages']),
  'Polar area': tagCard('chart', ['charts', 'comparison', 'dashboards'], ['donut-chart'], ['rose chart', 'coxcomb', 'polar chart']),
  'Error bars': tagCard('chart', ['charts', 'statistics', 'comparison'], ['chart'], ['confidence interval', 'A/B test', 'experiments', 'uncertainty', 'whiskers']),
  'Box and violin': tagCard('chart', ['charts', 'statistics', 'comparison'], ['box-violin-chart'], ['box plot', 'violin plot', 'quartiles', 'outliers', 'data science']),
  'Histogram and density': tagCard('chart', ['charts', 'statistics', 'dashboards'], ['density-histogram'], ['KDE', 'kernel density', 'distribution', 'bandwidth']),
  'Regression with confidence band': tagCard('chart', ['charts', 'statistics', 'comparison'], ['regression-chart'], ['trend line', 'line of best fit', 'correlation', 'confidence band', 'least squares']),
  'Forest plot': tagCard('chart', ['charts', 'statistics', 'comparison'], ['forest-plot'], ['meta-analysis', 'effect size', 'odds ratio', 'A/B test', 'subgroups']),
  'Sparklines': tagCard('chart', ['charts', 'finance', 'dashboards', 'real-time'], ['spark-chart', 'ticker-table'], ['sparkline', 'word-sized chart', 'ticker', 'win loss', 'inline chart']),
  'Treemap': tagCard('chart', ['charts', 'dashboards', 'finance', 'hierarchy'], ['treemap'], ['part to whole', 'budget', 'disk usage', 'nested rectangles']),
  'Tags over time': tagCard('chart', ['charts', 'monitoring', 'keyboard', 'new'], ['chart', 'swimlanes', 'state-ribbon', 'chart-with-journal', 'tag-journal', 'tag-glyph', 'tag-tooltip'], ['annotations', 'events', 'timeline', 'swimlanes', 'journal', 'pins', 'state ribbon', 'health']),
  // diagrams and maps
  'Gantt': tagCard('diagram', ['diagrams', 'planning', 'drag-and-drop', 'touch'], ['gantt'], ['gantt chart', 'roadmap', 'critical path', 'dependencies', 'project plan', 'timeline']),
  'State diagram': tagCard('diagram', ['diagrams', 'workflows', 'keyboard'], ['state-diagram', 'statechart'], ['UML', 'statechart', 'lifecycle', 'state machine', 'subscription', 'transitions']),
  'State machine': tagCard('diagram', ['diagrams', 'workflows', 'agents', 'real-time'], ['state-machine', 'statechart'], ['statechart', 'XState', 'fork join', 'automation', 'jobs']),
  'Trace waterfall': tagCard('diagram', ['diagrams', 'monitoring', 'agents', 'streaming'], ['trace-waterfall'], ['tracing', 'spans', 'observability', 'OpenTelemetry', 'APM', 'flame graph']),
  'Sankey': tagCard('chart', ['diagrams', 'charts', 'workflows', 'finance'], ['sankey'], ['flows', 'alluvial', 'budget flow', 'conversion paths', 'energy flow']),
  'Network graph': tagCard('diagram', ['diagrams', 'devtools', 'drag-and-drop', 'touch'], ['network-graph'], ['force layout', 'force-directed', 'relationships', 'nodes and edges', 'dependency graph']),
  'Process flow': tagCard('diagram', ['diagrams', 'workflows', 'drag-and-drop', 'touch'], ['process-flow'], ['node editor', 'workflow canvas', 'flowchart', 'DAG', 'zoom and pan']),
  'Data flow': tagCard('diagram', ['diagrams', 'workflows', 'monitoring', 'real-time'], ['data-flow'], ['ETL', 'pipeline', 'sources and destinations', 'data pipeline', 'stream processing']),
  'Map': tagCard('diagram', ['diagrams', 'geo', 'dashboards'], ['world-map'], ['choropleth', 'world map', 'countries', 'regions', 'geo map']),
  'Globe': tagCard('diagram', ['diagrams', 'geo', 'touch', 'animated'], ['globe'], ['3D globe', 'routes', 'earth', 'world', 'flights']),
  // code
  'Code block': tagCard(C, ['code', 'devtools', 'keyboard'], ['code-block'], ['syntax highlighting', 'snippet', 'pre', 'copy code', 'line numbers']),
  'Terminal': tagCard(C, ['code', 'devtools', 'streaming'], ['terminal'], ['console', 'CLI', 'shell', 'logs', 'command line']),
  'Tabbed example': tagCard(C, ['code', 'devtools', 'keyboard'], ['code-tabs'], ['code tabs', 'package manager', 'npm pnpm yarn', 'examples']),
  'Install command': tagCard(C, ['code', 'devtools', 'onboarding'], ['install-command'], ['npm install', 'copy command', 'getting started', 'CLI']),
  'Diff': tagCard(C, ['code', 'version-control', 'review'], ['diff'], ['changes', 'patch', 'pull request', 'code review', 'compare']),
  'Markdown': tagCard(C, ['code', 'ai', 'editing', 'streaming'], ['markdown'], ['md', 'GFM', 'markdown renderer', 'rich text', 'prose']),
  'Binary explorer': tagCard(C, ['code', 'data', 'devtools', 'keyboard', 'virtualised', 'new'], ['binary-view', 'hex-editor', 'byte-map', 'entropy-map', 'binary-section-list'], ['hex editor', 'hex viewer', 'hexdump', 'byte map', 'Hilbert curve', 'entropy', 'file inspector', 'reverse engineering', 'data inspector', 'ELF', 'PE']),
  'Graphs as rows': tagCard(C, ['code', 'diagrams', 'version-control', 'keyboard', 'virtualised', 'new'], ['lanes', 'git-graph'], ['DAG', 'lane graph', 'LaneGraph', 'git graph', 'commit graph', 'branches', 'AST', 'syntax tree', 'dependency graph', 'chat branches', 'agent run']),
  // media
  'Video player': tagCard(C, ['media', 'keyboard', 'touch', 'accessible'], ['video-player'], ['video', 'player', 'chapters', 'captions', 'fullscreen']),
  'Audio player': tagCard(C, ['media', 'keyboard', 'accessible'], ['audio-player', 'waveform'], ['podcast', 'music', 'waveform', 'chapters', 'playback speed']),
  'Carousel': tagCard(C, ['media', 'marketing', 'touch', 'keyboard'], ['carousel'], ['slider', 'slideshow', 'swipe', 'gallery']),
  'Before / after': tagCard(C, ['media', 'comparison', 'touch'], ['image-compare'], ['image compare', 'comparison slider', 'reveal', 'before and after']),
  'Masonry gallery': tagCard(C, ['media', 'marketing', 'animated'], ['masonry-gallery', 'lightbox'], ['gallery', 'image grid', 'pinterest', 'lightbox', 'portfolio']),
  'Media cards': tagCard(C, ['media', 'marketing', 'people'], ['media-card'], ['content card', 'thumbnail', 'feed', 'article card']),
  'Image with states': tagCard(C, ['media', 'async', 'accessible'], ['progressive-image'], ['lazy image', 'blur up', 'fallback', 'image error', 'placeholder']),
  'Compact audio': tagCard(C, ['media', 'chat', 'touch'], ['mini-audio-player', 'voice-note'], ['voice note', 'voice message', 'mini player']),
  'Avatar upload': tagCard(C, ['media', 'uploads', 'settings', 'touch'], ['avatar-cropper'], ['crop', 'cropper', 'profile photo', 'image upload']),
  // AI
  'Live chat (real stream)': tagCard('hook', ['ai', 'chat', 'agents', 'streaming', 'async'], ['ai-stream', 'conversation', 'message', 'message-parts', 'message-actions', 'prompt-input', 'suggestions'], ['useAiChat', 'AI SDK', 'assistant', 'tool calls', 'approvals', 'stop generating']),
  'Chat': tagCard(C, ['ai', 'chat', 'streaming', 'animated'], ['assistant-chat'], ['assistant', 'chatbot', 'copilot', 'slash commands', 'generative UI']),
  'Chat composer': tagCard(C, ['ai', 'chat', 'inputs', 'uploads', 'drag-and-drop'], ['agent-composer', 'prompt-input'], ['prompt box', 'prompt input', 'attachments', 'MCP', 'connectors', 'model picker']),
  'Thinking steps': tagCard(C, ['ai', 'agents', 'streaming', 'animated'], ['thinking-steps', 'reasoning'], ['reasoning', 'chain of thought', 'thoughts', 'working']),
  'Agent plan': tagCard(C, ['ai', 'agents', 'planning', 'real-time'], ['agent-plan'], ['todo list', 'tasks', 'plan', 'steps']),
  'Citations': tagCard(C, ['ai', 'chat', 'review'], ['citation', 'source-list'], ['sources', 'references', 'footnotes', 'trust', 'grounding']),
  'Permission request': tagCard(C, ['ai', 'agents', 'review'], ['permission-request'], ['human in the loop', 'tool approval', 'consent', 'allow once']),
  'Ghost text': tagCard(C, ['ai', 'inputs', 'editing', 'keyboard'], ['ghost-text-input'], ['inline completion', 'autocomplete', 'suggestion', 'tab to accept', 'copilot']),
  'Suggested edit': tagCard(C, ['ai', 'editing', 'review', 'keyboard'], ['suggested-edit'], ['track changes', 'accept or reject', 'diff', 'proposal']),
  'Confidence flags': tagCard(C, ['ai', 'forms', 'review', 'accessible'], ['confidence-field'], ['extraction', 'uncertainty', 'low confidence', 'needs review', 'OCR']),
  'Voice input': tagCard(C, ['ai', 'inputs', 'chat', 'animated'], ['voice-input'], ['dictation', 'speech to text', 'microphone', 'voice']),
  'Sources panel': tagCard(C, ['ai', 'search', 'review'], ['sources-panel', 'source-list'], ['research', 'citations', 'references', 'web results']),
  'Model comparison': tagCard(C, ['ai', 'data', 'comparison'], ['model-comparison'], ['evals', 'benchmarks', 'LLM comparison', 'side by side', 'arena']),
  'AI canvas': tagCard(C, ['ai', 'editing', 'code', 'experimental'], ['ai-canvas'], ['artifacts', 'canvas', 'document editor', 'side by side editing']),
  'Live agent run': tagCard('hook', ['ai', 'agents', 'monitoring', 'streaming', 'real-time', 'new'], ['agent-run', 'trace-waterfall', 'agent-transit-map', 'lanes'], ['useAgentRun', 'OpenTelemetry', 'OTLP', 'AI SDK', 'LangGraph', 'tracing', 'adapters', 'live data', 'replay']),
  'Agent transit map': tagCard('diagram', ['ai', 'diagrams', 'agents', 'workflows', 'real-time', 'experimental'], ['agent-transit-map'], ['orchestration', 'subway map', 'metro map', 'multi-agent', 'pipeline']),
}

/** Every tag a card carries, its kind first. */
export const tagCardTags = (c: TagCard): TagId[] => [c.kind, ...c.tags]

/** A card's tags in the order its chips show them: status, use cases, capabilities, then areas (the kind is left out). */
export function tagChipOrder(tags: readonly TagId[]): TagId[] {
  const rank: Record<TagFacet, number> = { status: 0, use: 1, capability: 2, area: 3, kind: 4 }
  return tags.filter(t => tagFacetOf(t) !== 'kind').map((t, i) => [t, i] as const).sort((a, b) => rank[tagFacetOf(a[0])] - rank[tagFacetOf(b[0])] || a[1] - b[1]).map(([t]) => t)
}

/* Search ───────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Lowercase, accents off, split into words ("Drag and drop" → drag, and, drop; "A/B" → a, b; "⌘K" → k). */
export const tagWords = (s: string): string[] => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
/** Plural to singular, roughly ("charts" → "chart", "dialogs" → "dialog"); short words and "-ss" stay. */
const tagStem = (w: string) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

/** What search looks at for a card or item: words, plus the label and synonyms of each of its tags. */
export type TagSearchable = { text: string; tags: readonly TagId[]; aka?: readonly string[] }
const tagHayCache = new Map<string, string[]>()
/** The searchable words of an entry (cached by its text and tags). */
export function tagHaystack(e: TagSearchable): string[] {
  const key = `${e.text}\u0000${e.tags.join(',')}\u0000${(e.aka ?? []).join(',')}`
  let words = tagHayCache.get(key)
  if (!words) {
    const parts = [e.text, ...(e.aka ?? []), ...e.tags.flatMap(t => [TAG_BY_ID[t].label, t, ...TAG_BY_ID[t].synonyms])]
    words = [...new Set(parts.flatMap(tagWords))]
    if (tagHayCache.size > 2000) tagHayCache.clear()
    tagHayCache.set(key, words)
  }
  return words
}
/** Does an entry match a typed query? Every query word must start a word of the entry, its tags or their synonyms. */
export function tagTextMatch(e: TagSearchable, query: string): boolean {
  const q = tagWords(query)
  if (!q.length) return true
  const hay = tagHaystack(e)
  return q.every(w => { const s = tagStem(w); return hay.some(h => h.startsWith(s) || h.startsWith(w)) })
}
/** Tags whose label, id or a synonym is exactly the query (to suggest "filter by this tag"). */
export function tagSuggest(query: string): TagId[] {
  const q = tagWords(query).join(' ')
  if (!q) return []
  return TAGS.filter(t => [t.label, t.id, ...t.synonyms].some(s => tagWords(s).join(' ') === q)).map(t => t.id)
}

/* Facet filter ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Does an entry carry the selected tags? OR within a facet, AND across facets (Inputs or Forms, and Keyboard). */
export function tagFilterMatch(tags: readonly TagId[], selected: readonly TagId[]): boolean {
  if (!selected.length) return true
  const facets = new Map<TagFacet, TagId[]>()
  for (const t of selected) { const f = tagFacetOf(t); facets.set(f, [...(facets.get(f) ?? []), t]) }
  for (const group of facets.values()) if (!group.some(t => tags.includes(t))) return false
  return true
}
/** Text query and selected tags together. */
export const tagMatches = (e: TagSearchable, query: string, selected: readonly TagId[]) => tagFilterMatch(e.tags, selected) && tagTextMatch(e, query)

/** For every tag, how many entries would match with it selected (its own facet's other picks are ignored, so the
 * numbers in a facet say what picking that chip adds; selected chips show their own count). */
export function tagFacetCounts(entries: readonly TagSearchable[], query: string, selected: readonly TagId[]): Record<TagId, number> {
  const counts = Object.fromEntries(TAGS.map(t => [t.id, 0])) as Record<TagId, number>
  const text = entries.filter(e => tagTextMatch(e, query))
  for (const f of TAG_FACETS) {
    const others = selected.filter(t => tagFacetOf(t) !== f.id)
    for (const e of text) if (tagFilterMatch(e.tags, others)) for (const t of e.tags) if (tagFacetOf(t) === f.id) counts[t]++
  }
  return counts
}

/** Selected tags in a stable order (facet, then vocabulary order), unknown ids and duplicates dropped. */
export function tagNormalize(ids: readonly string[]): TagId[] {
  const order = new Map(TAGS.map((t, i) => [t.id as string, i]))
  return [...new Set(ids)].filter(tagIsId).sort((a, b) => TAG_FACET_RANK[tagFacetOf(a)] - TAG_FACET_RANK[tagFacetOf(b)] || order.get(a)! - order.get(b)!)
}
/** Add a tag to the selection, or take it out. */
export const tagToggle = (selected: readonly TagId[], id: TagId): TagId[] => tagNormalize(selected.includes(id) ? selected.filter(t => t !== id) : [...selected, id])

/* URLs ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Read `?tags=a,b&q=…` from a location's search string. Unknown tags are ignored. */
export function tagParseUrl(search: string): { tags: TagId[]; q: string } {
  const p = new URLSearchParams(search)
  return { tags: tagNormalize((p.get('tags') ?? '').split(/[,\s]+/).filter(Boolean)), q: p.get('q') ?? '' }
}
/** A search string with the filter in it (other parameters kept), e.g. `?tags=search,keyboard&q=date`; '' when empty. */
export function tagSearchString(search: string, tags: readonly TagId[], q: string): string {
  const p = new URLSearchParams(search)
  p.delete('tags'); p.delete('q')
  const parts = p.toString() ? [p.toString()] : []
  if (tags.length) parts.push(`tags=${tagNormalize(tags).join(',')}`) // ids are [a-z0-9-]: readable without escaping
  if (q.trim()) parts.push(`q=${encodeURIComponent(q.trim()).replace(/%20/g, '+')}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

/* Registry items ───────────────────────────────────────────────────────────────────────────────────────────────── */

/** The area of a library module (src/lib/<module>.tsx); TAG_ITEM_AREA overrides it per item. */
export const TAG_MODULE_AREA: Readonly<Record<string, TagArea>> = {
  core: 'foundation', helpers: 'foundation', shared: 'foundation', locale: 'foundation', safe: 'foundation', hooks: 'foundation', slot: 'foundation',
  provider: 'foundation', motion: 'motion', virtual: 'data', icons: 'foundation', primitives: 'foundation', formcontrol: 'forms', magnet: 'inputs',
  overlay: 'overlays', formkit: 'forms', fields: 'inputs', select: 'inputs', inputs: 'inputs', pickers: 'inputs', upload: 'inputs', forms: 'forms',
  navigation: 'navigation', feedback: 'feedback', data: 'data', layout: 'layout', appearance: 'theming', theme: 'theming',
  annotate: 'charts', charts: 'charts', timeline: 'charts', diagramkit: 'diagrams', gantt: 'diagrams', statechart: 'diagrams', trace: 'diagrams',
  network: 'diagrams', diagrams: 'diagrams', geoworld: 'diagrams', geoland: 'diagrams', geo: 'diagrams',
  editor: 'forms', datagrid: 'data', scheduler: 'layout', code: 'code', markdown: 'code', media: 'media', collab: 'collaboration', pages: 'pages',
  lanes: 'code', gitgraph: 'code', aistream: 'ai', agentrun: 'ai', ai: 'ai', aichat: 'ai', aiagent: 'ai', themeexport: 'theming', binary: 'code',
}
/** Tags every item of a module gets (for modules no card covers yet). */
export const TAG_MODULE_TAGS: Readonly<Record<string, readonly TagId[]>> = {
  binary: ['devtools'], themeexport: ['devtools'], agentrun: ['agents'], locale: ['i18n'],
}
/** Items whose module's area doesn't fit (primitives that belong to one area, AI pieces that are diagrams …). */
export const TAG_ITEM_AREA: Readonly<Record<string, TagArea>> = {
  button: 'actions', 'async-button': 'actions', 'like-button': 'actions', 'copy-button': 'actions', 'hold-to-confirm': 'actions', 'dropdown-menu': 'actions', 'context-menu': 'actions',
  badge: 'feedback', spinner: 'feedback', skeleton: 'feedback', 'status-icon': 'feedback', 'typing-dots': 'feedback', confetti: 'motion', 'animated-number': 'motion',
  avatar: 'data', kbd: 'data', chip: 'inputs', card: 'layout', 'scroll-edges': 'layout', 'spark-chart': 'charts', collapse: 'layout', 'virtual-list': 'data',
  'org-chart': 'diagrams', 'agent-transit-map': 'diagrams', banner: 'feedback', 'notification-bell': 'overlays', 'inline-edit': 'inputs',
  'theme-toggle': 'theming', 'ui-provider': 'foundation', 'messages-de': 'foundation', 'messages-ar': 'foundation', 'locale-provider': 'foundation',
  'cookie-consent': 'pages', 'pricing-table': 'pages', checkout: 'pages', 'onboarding-checklist': 'pages', 'profile-card': 'pages',
  timeline: 'data', 'task-list': 'data', 'tree-view': 'layout', 'shortcut-sheet': 'data',
}
/** Tags for items no card demonstrates (or that do more than their cards show). */
export const TAG_ITEM_TAGS: Readonly<Record<string, readonly TagId[]>> = {
  'ui-provider': ['theming', 'i18n', 'accessible'], 'messages-de': ['i18n'], 'messages-ar': ['i18n'], 'locale-provider': ['i18n'], utils: ['devtools'],
  hooks: ['keyboard', 'touch', 'composable'], motion: ['animated'], 'virtual-list': ['virtualised'], icon: ['theming'], slot: ['composable'], 'ui-hosts': ['composable'],
  'ai-stream': ['streaming', 'async', 'chat', 'agents'], 'agent-run': ['agents', 'monitoring', 'streaming', 'real-time'], 'appearance-menu': ['settings'], 'appearance-panel': ['settings'], 'theme-toggle': ['settings'], 'theme-preview': ['comparison'],
  'tool-call': ['agents'], 'tool-card': ['agents'], 'approval-card': ['review', 'agents'], 'chat-approval': ['review', 'agents'], 'chat-card': ['chat'], 'chat-checklist': ['chat', 'planning'],
  'ai-renderers-provider': ['chat', 'composable'], 'chat-composer': ['chat', 'uploads'], 'animated-list': ['notifications', 'animated'], 'streaming-text': ['streaming', 'animated'], 'shimmer-text': ['animated'], 'typing-dots': ['chat', 'animated'],
  card: ['dashboards'], chip: ['filtering'], collapse: ['animated'], 'scroll-edges': ['touch'], lightbox: ['keyboard', 'touch'], waveform: ['animated'],
  'date-time-field': ['scheduling', 'keyboard'], 'nav-list': ['keyboard'], steps: ['onboarding'], 'magnet-bubble': ['touch'], 'magnet-marks': ['touch'],
}

/** Kind, area and tags of a registry item (dist-registry/index.json): its area from its module (or TAG_ITEM_AREA), its
 * kind from its type and module, and its tags from the cards that demonstrate it (most used first) and TAG_ITEM_TAGS. */
export function tagRegistryMeta(item: { name: string; type: string; module?: string }, cards: Readonly<Record<string, TagCard>> = TAG_CARDS): { kind: TagKind; area: TagArea; tags: TagId[] } {
  const area: TagArea = TAG_ITEM_AREA[item.name] ?? (item.module ? TAG_MODULE_AREA[item.module] : undefined) ?? 'foundation'
  const all = Object.values(cards).filter(c => c.items.includes(item.name))
  // tags come from the cards that are about this item (it is listed first); else from every card it appears in
  const main = all.filter(c => c.items[0] === item.name), demos = main.length ? main : all
  const kind: TagKind = item.type === 'registry:block' || area === 'pages' ? 'block' : item.type === 'registry:hook' ? 'hook' : item.type === 'registry:lib' ? 'utility'
    : area === 'charts' && item.name !== 'swimlanes' ? 'chart' : area === 'diagrams' ? 'diagram' : 'component'
  const freq = new Map<TagId, number>()
  for (const c of demos) for (const t of c.tags) freq.set(t, (freq.get(t) ?? 0) + (tagFacetOf(t) === 'area' ? 0.5 : 1))
  const ranked = [...freq].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  // the area first, then the item's own extras, then what its cards say (at most 8 in all)
  const tags = [...new Set<TagId>([area, ...(TAG_ITEM_TAGS[item.name] ?? []), ...ranked, ...((item.module && TAG_MODULE_TAGS[item.module]) || [])])].slice(0, 8)
  return { kind, area, tags }
}
