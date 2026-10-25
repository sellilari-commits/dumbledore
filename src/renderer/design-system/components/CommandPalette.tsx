/**
 * CommandPalette (⌘K): Notion's search modal — a big input, grouped results with icons and
 * snippets, ↑↓ / ↵ / Esc. The caller owns the items (static actions + search hits) and the
 * query; use `filterItems` for client-side matching of static items.
 */
import * as RadixDialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import '../styles/overlays.css'
import { Spinner } from './Spinner'

export interface PaletteItem {
  id: string
  group: string
  title: string
  subtitle?: string
  icon?: ReactNode
  shortcut?: string
  keywords?: string[]
  onSelect: () => void
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onQueryChange: (q: string) => void
  items: PaletteItem[]
  loading?: boolean
  placeholder?: string
  emptyText?: string
}

export function filterItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) =>
    [i.title, i.subtitle ?? '', ...(i.keywords ?? [])].some((t) => t.toLowerCase().includes(q)),
  )
}

export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  items,
  loading,
  placeholder = 'Search subjects, topics and what you’ve read…',
  emptyText = 'No results',
}: CommandPaletteProps) {
  const groups: Array<[string, PaletteItem[]]> = []
  for (const item of items) {
    const g = groups.find(([name]) => name === item.group)
    if (g) g[1].push(item)
    else groups.push([item.group, [item]])
  }
  const select = (item: PaletteItem) => {
    onOpenChange(false)
    item.onSelect()
  }
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dd-dialog__overlay" />
        <RadixDialog.Content className="dd-cmdk" aria-describedby={undefined}>
          <RadixDialog.Title className="dd-sr-only">Search</RadixDialog.Title>
          <Command shouldFilter={false} loop label="Search">
            <div className="dd-cmdk__input-row">
              {loading ? <Spinner size={16} /> : <Search size={18} aria-hidden />}
              <Command.Input
                className="dd-cmdk__input"
                value={query}
                onValueChange={onQueryChange}
                placeholder={placeholder}
                autoFocus
              />
            </div>
            <Command.List className="dd-cmdk__list">
              <Command.Empty className="dd-cmdk__empty">
                {loading ? 'Searching…' : emptyText}
              </Command.Empty>
              {groups.map(([name, list]) => (
                <Command.Group key={name} heading={name}>
                  {list.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={item.id}
                      className="dd-cmdk__item"
                      onSelect={() => select(item)}
                    >
                      <span className="dd-cmdk__item-icon" aria-hidden>
                        {item.icon}
                      </span>
                      <span className="dd-cmdk__item-text">
                        <span className="dd-cmdk__item-title">{item.title}</span>
                        {item.subtitle ? (
                          <span className="dd-cmdk__item-sub">{item.subtitle}</span>
                        ) : null}
                      </span>
                      {item.shortcut ? (
                        <span className="dd-menu__shortcut">{item.shortcut}</span>
                      ) : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className="dd-cmdk__footer" aria-hidden>
              <span>↑↓ Select</span>
              <span>↵ Open</span>
              <span>Esc Close</span>
            </div>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
