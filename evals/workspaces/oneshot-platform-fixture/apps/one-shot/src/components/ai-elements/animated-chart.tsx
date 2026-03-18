import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MODE_CONFIG, MODE_ORDER } from "@/features/app/modeConfig";
import type { AppMode } from "@/features/app/types";

type ChartData = {
  mode: AppMode;
  label: string;
  value: number;
  color: string;
  subItems: { label: string; value: number }[];
};

function buildChartData(): ChartData[] {
  return MODE_ORDER.map((mode) => {
    const config = MODE_CONFIG[mode];
    const navCount = config.navItems.length;
    return {
      mode,
      label: config.label,
      value: navCount > 0 ? navCount * 12 + Math.floor(Math.random() * 20) : Math.floor(Math.random() * 8),
      color: config.color,
      subItems: config.navItems.map((item) => ({
        label: item.label,
        value: Math.floor(Math.random() * 30) + 5,
      })),
    };
  });
}

export function AnimatedChart() {
  const [data] = useState(buildChartData);
  const [drillMode, setDrillMode] = useState<AppMode | null>(null);
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const drillData = drillMode
    ? data.find((d) => d.mode === drillMode)
    : null;
  const drillMax = drillData
    ? Math.max(...drillData.subItems.map((s) => s.value), 1)
    : 1;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          {drillMode ? `${MODE_CONFIG[drillMode].label} — Sub-agents` : "Usage by Mode"}
        </span>
        {drillMode ? (
          <button
            type="button"
            onClick={() => setDrillMode(null)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Back
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 items-end gap-2">
        <AnimatePresence mode="wait">
          {drillMode && drillData ? (
            <motion.div
              key="drill"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="flex w-full items-end gap-2"
            >
              {drillData.subItems.map((sub) => {
                const pct = (sub.value / drillMax) * 100;
                return (
                  <div
                    key={sub.label}
                    className="flex flex-1 flex-col items-center gap-1"
                  >
                    <motion.div
                      className="w-full rounded-t"
                      style={{
                        backgroundColor: `hsl(${drillData.color})`,
                        opacity: 0.7,
                      }}
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(pct, 4)}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                    <span className="max-w-full truncate text-[9px] text-muted-foreground">
                      {sub.label}
                    </span>
                  </div>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="overview"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
              className="flex w-full items-end gap-2"
            >
              {data.map((d) => {
                const pct = (d.value / maxVal) * 100;
                const hasChildren = d.subItems.length > 0;
                return (
                  <button
                    key={d.mode}
                    type="button"
                    className="flex flex-1 flex-col items-center gap-1"
                    onClick={() => hasChildren && setDrillMode(d.mode)}
                    disabled={!hasChildren}
                  >
                    <motion.div
                      className="w-full rounded-t transition-opacity hover:opacity-80"
                      style={{ backgroundColor: `hsl(${d.color})` }}
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(pct, 4)}%` }}
                      transition={{
                        duration: 0.6,
                        ease: "easeOut",
                        delay: MODE_ORDER.indexOf(d.mode) * 0.08,
                      }}
                    />
                    <span className="text-[9px] text-muted-foreground">
                      {d.label}
                    </span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
