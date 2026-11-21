"use client";

import { createContext, useContext } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

/**
 * Contexto de arrastar. Os itens só respondem ao handle — assim, tocar no
 * card (para editar) nunca inicia um arraste acidental.
 */
const DragContext = createContext(false);

export function SortableProvider({
  ids,
  onReorder,
  onDragStateChange,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  onDragStateChange?: (dragging: boolean) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    // Toque longo antes de arrastar: evita conflito com o scroll da lista.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleStart = (_event: DragStartEvent) => onDragStateChange?.(true);

  const handleEnd = (event: DragEndEvent) => {
    onDragStateChange?.(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const next = [...ids];
    const [moved] = next.splice(oldIndex, 1);
    if (!moved) return;
    next.splice(newIndex, 0, moved);
    onReorder(next);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => onDragStateChange?.(false)}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <DragContext.Provider value={true}>{children}</DragContext.Provider>
      </SortableContext>
    </DndContext>
  );
}

export type DragHandleProps = {
  ref: (node: HTMLElement | null) => void;
  listeners: SyntheticListenerMap | undefined;
  attributes: DraggableAttributes;
  isDragging: boolean;
};

/** Envolve um item arrastável. Use `handleProps` no botão de arrastar. */
export function SortableItem({
  id,
  children,
  className,
}: {
  id: string;
  className?: string;
  children: (args: { handleProps: DragHandleProps; isDragging: boolean }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "relative touch-manipulation",
        isDragging && "z-20 opacity-95",
        className,
      )}
    >
      {children({
        handleProps: {
          ref: setActivatorNodeRef,
          listeners,
          attributes,
          isDragging,
        },
        isDragging,
      })}
    </div>
  );
}

export function useIsSortable() {
  return useContext(DragContext);
}
