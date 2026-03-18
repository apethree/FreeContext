import { motion } from "framer-motion";

type TimelineEvent = {
  id: string;
  time: string;
  label: string;
  status: "success" | "info" | "warning" | "error";
};

const statusColors: Record<TimelineEvent["status"], string> = {
  success: "bg-emerald-500",
  info: "bg-blue-500",
  warning: "bg-amber-500",
  error: "bg-rose-500",
};

const mockEvents: TimelineEvent[] = [
  { id: "1", time: "now", label: "Waiting for input...", status: "info" },
  { id: "2", time: "10s ago", label: "Generated dashboard summary", status: "success" },
  { id: "3", time: "25s ago", label: "Fetched account data", status: "success" },
  { id: "4", time: "32s ago", label: "Parsed user query", status: "info" },
  { id: "5", time: "45s ago", label: "Session started", status: "info" },
];

export function ActivityTimeline() {
  return (
    <div className="flex flex-col gap-0">
      <div className="mb-2 text-xs font-semibold text-foreground">
        Activity
      </div>
      <div className="relative space-y-0">
        {/* Connecting line */}
        <div className="absolute left-[5px] top-1 bottom-1 w-px bg-border" />

        {mockEvents.map((event, idx) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05, duration: 0.3 }}
            className="relative flex items-start gap-3 py-1.5 pl-0"
          >
            <div
              className={`relative z-10 mt-1 h-[10px] w-[10px] shrink-0 rounded-full border-2 border-card ${statusColors[event.status]}`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-foreground">{event.label}</p>
              <p className="text-[10px] text-muted-foreground">{event.time}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
