import type { ReactNode } from "react";

export type TableColumn<Row> = {
  key: string;
  header: ReactNode;
  numeric?: boolean;
  cell: (row: Row) => ReactNode;
};

export type TableProps<Row> = {
  caption: string;
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
};

/** Sticky header, right-aligned numbers (PRD 14.6). */
export function Table<Row>({ caption, columns, rows, rowKey }: TableProps<Row>) {
  return (
    // A focusable region so keyboard users can scroll a wide table on small screens (WCAG 2.1.1).
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the scroll container must take focus
    <section className="pr-table-wrap" aria-label={caption} tabIndex={0}>
      <table className="pr-table">
        <caption className="pr-sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-numeric={column.numeric || undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-numeric={column.numeric || undefined}
                  data-label={typeof column.header === "string" ? column.header : undefined}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
