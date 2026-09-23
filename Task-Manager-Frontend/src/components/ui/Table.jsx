/**
 * Presentation-only table shell. Consumers pass columns + rows; row/cell
 * rendering stays fully in their control via `render`, so existing per-page
 * logic (menus, links, formatting) drops in unchanged.
 *
 * columns: [{ key, header, className?, render?: (row) => node }]
 */
export default function Table({ columns, rows, rowKey = (row) => row.id, className = "" }) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-hair bg-surface-1 ${className}`}>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-hair">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-txt-muted ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-hair last:border-b-0 hover:bg-surface-2"
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-3 align-middle text-txt-primary ${col.className ?? ""}`}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
