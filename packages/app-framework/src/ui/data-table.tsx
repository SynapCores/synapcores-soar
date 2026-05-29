import * as React from 'react';
import { cn } from './cn';

/**
 * Lightweight table primitive. Pass an array of rows + column
 * definitions; the table handles markup + empty states. Sorting +
 * filtering + pagination live in higher-level wrappers (we add
 * @tanstack/react-table when a screen actually needs it).
 *
 * Server-side filtering / pagination: the caller fetches the slice
 * they want and passes it in. Pages with > a few hundred rows should
 * paginate at the API layer (audit log already does this — see
 * /api/audit).
 */

export interface DataTableColumn<Row> {
  key: string;
  header: React.ReactNode;
  /** Cell renderer. Defaults to `row[key]` if omitted. */
  cell?: (row: Row) => React.ReactNode;
  /** Optional Tailwind classes for the cell. */
  className?: string;
  /** Header-only Tailwind classes. */
  headerClassName?: string;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  emptyState?: React.ReactNode;
  /** Pass a row id selector if you need stable keys (eg. for animations). */
  rowKey?: (row: Row, index: number) => string;
}

export function DataTable<Row>({
  columns,
  rows,
  emptyState,
  rowKey,
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        {emptyState ?? 'No rows yet.'}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full text-sm">
        <thead className="bg-card">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'text-left font-semibold text-muted-foreground px-4 py-2 border-b border-border',
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : i}
              className="hover:bg-accent/30 transition-colors"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4 py-2 border-b border-border/60 text-foreground',
                    col.className,
                  )}
                >
                  {col.cell
                    ? col.cell(row)
                    : ((row as Record<string, unknown>)[col.key] as React.ReactNode) ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
