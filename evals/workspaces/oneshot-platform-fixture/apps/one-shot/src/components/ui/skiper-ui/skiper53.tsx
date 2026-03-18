import { motion } from 'framer-motion';
import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

type Skiper53Item = {
  id: string;
  collapsedLabel: string;
  collapsedHint?: string | null;
  content: React.ReactNode;
  collapsedContent?: React.ReactNode;
  className?: string;
};

const HoverExpand_002 = ({
  items,
  className,
  panelClassName,
  collapsedHeight = '3.25rem',
  expandedHeight = '34rem',
  activeIndex,
  onActiveIndexChange,
}: {
  items: Skiper53Item[];
  className?: string;
  panelClassName?: string;
  collapsedHeight?: number | string;
  expandedHeight?: number | string;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
}) => {
  const [internalActive, setInternalActive] = useState(0);
  const resolvedActive =
    typeof activeIndex === 'number' ? activeIndex : internalActive;

  const safeActive = useMemo(() => {
    if (!Number.isFinite(resolvedActive) || items.length === 0) return 0;
    return Math.min(Math.max(resolvedActive, 0), items.length - 1);
  }, [resolvedActive, items.length]);

  const setActive = (index: number) => {
    onActiveIndexChange?.(index);
    if (activeIndex === undefined) {
      setInternalActive(index);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, translateY: 20 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{
        duration: 0.3,
        delay: 0.5,
      }}
      className={cn('relative w-full max-w-6xl px-5', className)}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full"
      >
        <div className="flex w-full flex-col items-center justify-center gap-2">
          {items.map((item, index) => (
            <motion.div
              key={item.id}
              initial={false}
              className={cn(
                'group relative w-full cursor-pointer overflow-hidden rounded-[32px] border border-neutral-200/70 bg-white/70 shadow-[0_20px_60px_-40px_rgba(38,38,38,0.35)] backdrop-blur-md will-change-[height]',
                panelClassName,
                item.className,
              )}
              animate={{
                height: safeActive === index ? expandedHeight : collapsedHeight,
              }}
              transition={{
                type: 'spring',
                stiffness: 230,
                damping: 30,
                mass: 0.85,
              }}
              onClick={() => {
                if (safeActive !== index) setActive(index);
              }}
              onHoverStart={() => {
                if (safeActive !== index) setActive(index);
              }}
            >
              <div
                className={cn(
                  'pointer-events-none absolute inset-0 bg-gradient-to-t from-black/[0.02] via-transparent to-white/40 transition-opacity duration-200',
                  safeActive === index ? 'opacity-100' : 'opacity-82',
                )}
              />
              <div
                className={cn(
                  'absolute inset-0 z-[6] transition-opacity duration-200',
                  safeActive === index
                    ? 'pointer-events-none opacity-0'
                    : 'pointer-events-none opacity-100',
                )}
              >
                {item.collapsedContent}
              </div>
              <div
                className={cn(
                  'absolute inset-0 z-10 transition-opacity duration-200',
                  safeActive === index
                    ? 'pointer-events-auto opacity-100'
                    : 'pointer-events-none opacity-0',
                )}
              >
                <div className="flex h-full w-full flex-col">{item.content}</div>
              </div>
              <div
                className={cn(
                  'pointer-events-none absolute inset-0 z-20 flex items-center justify-between bg-black/45 px-8 text-[1.15rem] font-semibold tracking-tight text-white transition-opacity duration-200 md:text-[1.55rem]',
                  safeActive === index ? 'opacity-0' : 'opacity-100',
                )}
                style={{
                  transitionDelay: safeActive === index ? '0ms' : '120ms',
                }}
              >
                <span>{item.collapsedLabel}</span>
                {item.collapsedHint ? (
                  <span className="text-white">{item.collapsedHint}</span>
                ) : null}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

export { HoverExpand_002 };
export type { Skiper53Item };
