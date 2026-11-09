import { Badge, Checkout, OnboardingChecklist, PricingTable, ProfileCard, type SettingsSection, SettingsPage, useTheme, useToast } from '../lib'
import { Section, Spec } from './kit'

const PAGES_POSTS: [string, string, string][] = [['Designing calm dashboards', '2 days ago', 'var(--accent)'], ['Motion as feedback, not decoration', '1 week ago', 'var(--c3)']]

export function PagesSection() {
  const toast = useToast()
  const { settings, set } = useTheme()
  const soon = (title: string) => () => toast({ title, description: 'Demo only: this would open a dialog', tone: 'info' })
  const sections: SettingsSection[] = [
    { id: 'profile', label: 'Profile', icon: 'user', description: 'How you appear to your team', rows: [
      { id: 'name', type: 'text', label: 'Display name', description: 'Shown on comments and mentions', value: 'Alex Lee' },
      { id: 'pronouns', type: 'text', label: 'Pronouns', description: 'Optional', value: '', placeholder: 'e.g. they/them' },
      { id: 'online', type: 'toggle', label: 'Show online status', description: 'Others see when you are active', value: true }] },
    { id: 'notifications', label: 'Notifications', icon: 'bell', description: 'Choose what reaches you, and where', rows: [
      { id: 'mentions', type: 'toggle', label: 'Mentions', description: 'When someone @mentions you', value: true },
      { id: 'digest', type: 'toggle', label: 'Weekly digest', description: 'Monday summary of activity', value: false },
      { id: 'updates', type: 'toggle', label: 'Product updates', description: 'New features, at most monthly', value: false }] },
    { id: 'security', label: 'Security', icon: 'shield', description: 'Keep your account safe', rows: [
      { id: '2fa', type: 'action', label: 'Two-factor authentication', description: 'Authenticator app enabled', action: 'Manage', onClick: soon('Two-factor authentication') },
      { id: 'passkeys', type: 'action', label: 'Passkeys', description: '2 passkeys registered', action: 'Add passkey', onClick: soon('Add a passkey') },
      { id: 'sessions', type: 'action', label: 'Active sessions', description: 'Zürich · London', action: 'Review', onClick: soon('Active sessions') }] },
    { id: 'billing', label: 'Billing', icon: 'card', description: 'Plan, invoices and payment method', rows: [
      { id: 'plan', type: 'action', label: 'Plan', description: 'Pro · 5 seats · renews 1 Dec', action: 'Change plan', onClick: soon('Change plan') },
      { id: 'card', type: 'action', label: 'Payment method', description: 'Visa ending 4242', action: 'Update', onClick: soon('Update payment method') },
      { id: 'invoices', type: 'action', label: 'Invoices', description: '12 available', action: 'View all', onClick: soon('Invoices') }] },
    { id: 'appearance', label: 'Appearance', icon: 'sun', description: 'Theme, density and motion', rows: [
      { id: 'theme', type: 'select', label: 'Theme', description: 'Applies to the whole library right away', value: settings.mode,
        options: [{ value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] },
      { id: 'compact', type: 'toggle', label: 'Compact mode', description: 'Denser tables and lists', value: false },
      { id: 'motion', type: 'toggle', label: 'Reduce motion', description: 'Follows your system by default', value: false }] },
  ]
  return (
    <Section id="pages" title="Pages" desc="Full page patterns you can drop into a product: pricing, checkout, settings, profile and onboarding.">
      <Spec title="Pricing table" desc="Toggle the period; prices roll" span={3}>
        <PricingTable onChoose={(p, y) => toast({ title: `${p.name} selected`, description: y ? 'Billed yearly' : 'Billed monthly' })} plans={[
          { name: 'Starter', monthly: 0, blurb: 'For individuals getting started', features: ['3 projects', 'Basic analytics', 'Community support'], missing: ['Custom domains', 'SSO'] },
          { name: 'Pro', monthly: 24, blurb: 'For growing teams that ship weekly', features: ['Unlimited projects', 'Advanced analytics', 'Priority support', 'Custom domains'], missing: ['SSO'], featured: true },
          { name: 'Enterprise', monthly: 79, blurb: 'Security, scale and support', features: ['Everything in Pro', 'SSO and SCIM', 'Audit logs', 'Dedicated manager', 'SLA 99.99%'], cta: 'Contact sales' },
        ]} />
      </Spec>
      <Spec title="Checkout" desc="Steps with an order summary. Try the promo code SAVE10, and a card number to see the brand detected." span={3}>
        <Checkout items={[
          { id: 'pro', name: 'Pro plan', detail: 'Annual · 5 seats', price: 1152, qty: 1, swatch: 'linear-gradient(135deg,var(--accent),var(--c4))' },
          { id: 'storage', name: 'Extra storage', detail: '100 GB add-on', price: 48, qty: 1, swatch: 'linear-gradient(135deg,var(--c3),var(--warn))' },
        ]} />
      </Spec>
      <Spec title="Settings page" desc="Section nav on the left, panels swap with a slide. Changes save automatically." span={3}>
        <SettingsPage sections={sections} onSave={(id, v) => { if (id === 'theme') set({ mode: v as 'system' | 'light' | 'dark' }) }} />
      </Spec>
      <Spec title="Profile" desc="Cover, avatar, stats and tabs. Follow toggles and the count rolls." span={2}>
        <ProfileCard name="Alex Lee" pro followers={12849} following={312} projects={48}
          bio="Design engineer at Northwind. Calm interfaces, fast feedback. Zürich."
          onMessage={() => toast({ title: 'Message Alex', description: 'Opens a conversation in the inbox', tone: 'info' })}
          tabs={[
            { value: 'posts', label: 'Posts', content: (
              <ul className="m-0 list-none p-0">
                {PAGES_POSTS.map(([t, d, c]) => (
                  <li key={t} className="flex gap-2.5 border-b border-[var(--line)] py-2 last:border-0">
                    <i className="h-12 w-12 flex-none rounded-[var(--r-md)] opacity-80" style={{ background: c }} />
                    <div><b className="font-medium text-[var(--fg)]">{t}</b><div className="text-xs text-[var(--fg3)]">{d}</div></div>
                  </li>
                ))}
              </ul>) },
            { value: 'projects', label: 'Projects', content: <div className="flex flex-wrap gap-2">{['UI library', 'Flows', 'Northwind web'].map(p => <Badge key={p}>{p}</Badge>)}</div> },
            { value: 'about', label: 'About', content: 'Previously at Linear-style startups. Speaks English and German. Joined March 2021.' },
          ]} />
      </Spec>
      <Spec title="Onboarding checklist" desc="Progress ring, tick items off, celebrate at 100%">
        <OnboardingChecklist defaultValue={['workspace', 'invite']} tasks={[
          { id: 'workspace', label: 'Create your workspace', estimate: '~1 min' },
          { id: 'invite', label: 'Invite a teammate', estimate: '~1 min' },
          { id: 'data', label: 'Connect your data', estimate: '~3 min' },
          { id: 'dashboard', label: 'Build your first dashboard', estimate: '~5 min' },
          { id: 'alerts', label: 'Set up alerts', estimate: '~2 min' },
        ]} />
      </Spec>
    </Section>
  )
}
