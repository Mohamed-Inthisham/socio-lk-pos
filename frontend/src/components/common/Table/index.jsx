import { Inbox } from "lucide-react";

/**
 * Table Component
 *
 * A responsive data table. Renders as a traditional table on desktop
 * (>=768px) and as a stacked card list on mobile (<768px). Same data,
 * same columns config, different layout — no code duplication at call site.
 *
 * COLUMNS CONFIG:
 * Each column is { key, header, render?, align?, mobileHidden?, primary?, secondary? }
 * - key: unique string, used as React key
 * - header: label for the column header (desktop) or hidden on mobile
 * - render: (row) => ReactNode. If omitted, uses row[key] as-is.
 * - align: 'left' | 'right' | 'center'. Defaults to 'left'.
 * - mobileHidden: hide this column on mobile card view
 * - primary: mark the column that becomes the card's headline on mobile
 * - secondary: mark the column that becomes the card's subtext on mobile
 *
 * If no primary is marked, the first non-hidden column is used.
 *
 * PROPS:
 * - columns: config array (above)
 * - data: array of row objects
 * - keyField: which row property to use as React key (default 'id')
 * - loading: boolean, shows skeleton rows
 * - onRowClick: (row) => void, makes rows interactive
 * - emptyMessage: string, shown when data is empty (default 'No results')
 */

const alignClass = (align) =>
  align === "right"
    ? "text-right"
    : align === "center"
      ? "text-center"
      : "text-left";

const SkeletonRow = ({ colCount }) => (
  <tr className="border-t border-slate-200 dark:border-slate-700">
    {Array.from({ length: colCount }).map((_, i) => (
      <td key={i} className="px-4 py-4">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
      </td>
    ))}
  </tr>
);

const SkeletonCard = () => (
  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-3/4" />
    <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-1/2" />
    <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-2/3" />
  </div>
);

const EmptyState = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
      <Inbox size={22} className="text-slate-400 dark:text-slate-500" />
    </div>
    <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
  </div>
);

const Table = ({
  columns,
  data = [],
  keyField = "id",
  loading = false,
  onRowClick,
  emptyMessage = "No results",
}) => {
  const visibleColumns = columns.filter((c) => !c.mobileHidden);
  const primaryCol =
    columns.find((c) => c.primary) || visibleColumns[0] || null;
  const secondaryCol = columns.find((c) => c.secondary) || null;
  const detailCols = visibleColumns.filter(
    (c) => c !== primaryCol && c !== secondaryCol,
  );

  const renderCell = (col, row) =>
    col.render ? col.render(row) : row[col.key];

  return (
    <>
      {/* DESKTOP TABLE */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`
                    ${alignClass(col.align)}
                    px-4 py-3
                    text-xs font-semibold uppercase tracking-wider
                    text-slate-500 dark:text-slate-400
                  `}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 3 }).map((_, i) => (
                <SkeletonRow key={i} colCount={columns.length} />
              ))}

            {!loading &&
              data.length > 0 &&
              data.map((row) => (
                <tr
                  key={row[keyField]}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`
                    border-t border-slate-200 dark:border-slate-700
                    ${
                      onRowClick
                        ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        : ""
                    }
                  `}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`
                        ${alignClass(col.align)}
                        px-4 py-3.5
                        text-slate-700 dark:text-slate-200
                      `}
                    >
                      {renderCell(col, row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>

        {!loading && data.length === 0 && <EmptyState message={emptyMessage} />}
      </div>

      {/* MOBILE CARDS */}
      <div className="md:hidden space-y-2">
        {loading &&
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}

        {!loading &&
          data.length > 0 &&
          data.map((row) => (
            <div
              key={row[keyField]}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`
                rounded-xl border border-slate-200 dark:border-slate-700
                bg-white dark:bg-slate-800
                p-4
                ${
                  onRowClick
                    ? "cursor-pointer active:bg-slate-50 dark:active:bg-slate-700 transition-colors"
                    : ""
                }
              `}
            >
              {primaryCol && (
                <div className="font-semibold text-slate-900 dark:text-slate-100 mb-0.5">
                  {renderCell(primaryCol, row)}
                </div>
              )}

              {secondaryCol && (
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  {renderCell(secondaryCol, row)}
                </div>
              )}

              {detailCols.length > 0 && (
                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2 space-y-1.5">
                  {detailCols.map((col) => (
                    <div
                      key={col.key}
                      className="flex justify-between items-center gap-3 text-sm"
                    >
                      <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {col.header}
                      </span>
                      <span className="text-slate-700 dark:text-slate-200 text-right">
                        {renderCell(col, row)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

        {!loading && data.length === 0 && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <EmptyState message={emptyMessage} />
          </div>
        )}
      </div>
    </>
  );
};

export default Table;
