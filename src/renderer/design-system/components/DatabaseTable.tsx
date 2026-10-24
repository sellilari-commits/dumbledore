/**
 * DatabaseTable: Notion's table view — header row with property icons, hairline grid,
 * 36 px rows, optional row click (keyboard-accessible), a count footer and an empty row.
 */
import type { KeyboardEvent, ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/layout.css'

export interface Column<Row> {
  key: string
  header: string
  icon?: ReactNode
  width?: number | string
  render: (row: Row) => ReactNode
  align?: 'left' | 'right'
}

export interface DatabaseTableProps<Row> {
  columns: ReadonlyArray<Column<Row>>
  rows: ReadonlyArray<Row>
  rowKey: (row: Row) => string
  onRowClick?: (row: Row) => void
  /** Accessible name for the table. */
  label: string
  empty?: ReactNode
  footer?: ReactNode | false
  className?: string
}

export function DatabaseTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  label,
  empty,
  footer,
  className,
}: DatabaseTableProps<Row>) {
  const onKey = (row: Row) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRowClick?.(row)
    }
  }
  return (
    <div className={cx('dd-table-wrap', className)}>
      <table className="dd-table" aria-label={label}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width === undefined ? undefined : { width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={c.align === 'right' ? { textAlign: 'right' } : undefined}>
                <span className="dd-table__th">
                  {c.icon}
                  {c.header}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              data-clickable={onRowClick ? 'true' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? onKey(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && empty ? (
            <tr>
              <td colSpan={columns.length} className="dd-table__muted">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {footer === false ? null : (
        <div className="dd-table__footer">{footer ?? `Count ${rows.length}`}</div>
      )}
    </div>
  )
}
