import { Icon } from '../lib/core'
import type { NavItem } from '../lib/navigation'

/** CollapsibleSidebar demo pane: the selected page's title over placeholder cards. */
export function SidebarPage({ item }: { item: NavItem }) {
  return (
    <>
      <h4 className="m-0 flex items-center gap-2 text-base font-semibold">{item.icon && <Icon name={item.icon} size={16} className="text-[var(--fg3)]" />}{item.label}</h4>
      <div className="grid grid-cols-3 gap-2.5">{[0, 1, 2].map(k => <div key={k} className="h-[70px] rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)]" />)}</div>
      <div className="min-h-[80px] flex-1 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--card)]" />
    </>
  )
}
