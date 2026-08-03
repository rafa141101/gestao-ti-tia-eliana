import { useState, type ReactNode } from 'react';

export interface KanbanColumn<T> {
  key: string;
  title: string;
  items: T[];
}

interface KanbanProps<T> {
  columns: KanbanColumn<T>[];
  renderCard: (item: T) => ReactNode;
  getId: (item: T) => string;
  /** Retorna true se o item pode ir para a coluna destino (validação local). */
  canDrop?: (item: T, toColumn: string) => boolean;
  onDrop?: (item: T, toColumn: string) => void;
}

/** Kanban simples com drag-and-drop nativo (HTML5) e validação de transições. */
export function Kanban<T>({ columns, renderCard, getId, canDrop, onDrop }: KanbanProps<T>) {
  const [dragging, setDragging] = useState<T | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {columns.map((col) => {
        const droppable = dragging != null && (canDrop?.(dragging, col.key) ?? true);
        return (
          <div
            key={col.key}
            className={`flex w-72 shrink-0 flex-col rounded-xl border bg-slate-50 ${
              overCol === col.key ? (droppable ? 'border-brand-400 bg-brand-50' : 'border-red-300 bg-red-50') : 'border-slate-200'
            }`}
            onDragOver={(e) => {
              if (dragging && droppable) e.preventDefault();
              setOverCol(col.key);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={() => {
              if (dragging && droppable) onDrop?.(dragging, col.key);
              setDragging(null);
              setOverCol(null);
            }}
          >
            <div className="flex items-center justify-between px-3 py-2.5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{col.title}</p>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">{col.items.length}</span>
            </div>
            <div className="flex min-h-24 flex-col gap-2 px-2 pb-2">
              {col.items.map((item) => (
                <div
                  key={getId(item)}
                  draggable={!!onDrop}
                  onDragStart={() => setDragging(item)}
                  onDragEnd={() => { setDragging(null); setOverCol(null); }}
                  className={onDrop ? 'cursor-grab active:cursor-grabbing' : ''}
                >
                  {renderCard(item)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
