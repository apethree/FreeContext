'use client';

import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

const SortableItemContext = React.createContext<{
  listeners: DraggableSyntheticListeners | undefined;
  isDragging: boolean;
  disabled: boolean;
}>({
  listeners: undefined,
  isDragging: false,
  disabled: false,
});

type SortableRootProps<T> = {
  value: T[];
  onValueChange: (value: T[]) => void;
  getItemValue: (item: T) => string;
  className?: string;
  children: React.ReactNode;
};

function Sortable<T>({
  value,
  onValueChange,
  getItemValue,
  className,
  children,
}: SortableRootProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = React.useMemo(() => value.map((item) => getItemValue(item)), [value, getItemValue]);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }

      const activeIndex = value.findIndex((item) => getItemValue(item) === active.id);
      const overIndex = value.findIndex((item) => getItemValue(item) === over.id);

      if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
        return;
      }

      onValueChange(arrayMove(value, activeIndex, overIndex));
    },
    [getItemValue, onValueChange, value],
  );

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={cn(className)}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

type SortableItemProps = {
  value: string;
  className?: string;
  asChild?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
};

function SortableItem({ value, className, asChild = false, disabled = false, children }: SortableItemProps) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: value as UniqueIdentifier,
    disabled,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  } as React.CSSProperties;

  const Comp = asChild ? Slot.Root : 'div';

  return (
    <SortableItemContext.Provider value={{ listeners, isDragging, disabled }}>
      <Comp ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-70', className)} {...attributes}>
        {children}
      </Comp>
    </SortableItemContext.Provider>
  );
}

type SortableItemHandleProps = {
  asChild?: boolean;
  className?: string;
  children?: React.ReactNode;
};

function SortableItemHandle({ asChild = false, className, children }: SortableItemHandleProps) {
  const { listeners, isDragging, disabled } = React.useContext(SortableItemContext);
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp className={cn(!disabled && (isDragging ? 'cursor-grabbing' : 'cursor-grab'), className)} {...listeners}>
      {children}
    </Comp>
  );
}

export { Sortable, SortableItem, SortableItemHandle };
