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
    <div className="pr-table-wrap">
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
                <td key={column.key} data-numeric={column.numeric || undefined}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
