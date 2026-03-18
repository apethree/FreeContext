import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageContentContainer } from "@/features/app/PageContentContainer";
import { MODE_CONFIG, MODE_ORDER } from "@/features/app/modeConfig";
import { modeIcon } from "@/features/sidebar/ModeSwitcher";

const HOME_SUMMARY = [
  { label: "Active mode sessions", value: "11", detail: "Across all domains" },
  { label: "Queued actions", value: "19", detail: "Awaiting execution" },
  { label: "Automation health", value: "95%", detail: "No critical incidents" },
  { label: "Assistant awareness", value: "High", detail: "Cross-domain context enabled" },
];

export function HomePage() {
  const navigate = useNavigate();
  const modeCards = useMemo(
    () =>
      MODE_ORDER.map((mode) => ({
        mode,
        title: MODE_CONFIG[mode].label,
        navCount: MODE_CONFIG[mode].navItems.length,
      })),
    [],
  );

  return (
    <PageContentContainer className="max-w-6xl gap-3">
      <section className="surface-raised px-5 py-5">
        <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          Global Home
        </p>
        <h1 className="mt-1 text-base font-semibold text-foreground">
          Intelligence overview across all modes
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Home stays global and persistent. Switch into any mode for focused work without
          exposing unrelated context.
        </p>
      </section>

      <section className="grid gap-2 md:grid-cols-4">
        {HOME_SUMMARY.map((item) => (
          <article key={item.label} className="surface-raised px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">{item.value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{item.detail}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {modeCards.map((card) => (
          <button
            key={card.mode}
            type="button"
            onClick={() => navigate(`/home/mode/${card.mode}`)}
            className="surface-raised group flex flex-col items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-accent/45"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-background/70">
              {(() => {
                const ModeIcon = modeIcon(card.mode);
                return <ModeIcon className="h-4 w-4 text-foreground/80" />;
              })()}
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">{card.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {card.navCount > 0
                  ? `${card.navCount} workspace modules available`
                  : "Mode parent page ready"}
              </p>
            </div>
          </button>
        ))}
      </section>

      <section className="surface-recessed">
        <article className="surface-raised px-4 py-4">
          <p className="text-sm font-medium text-foreground">Global assistant</p>
          <p className="mt-1 text-xs text-muted-foreground">
            I am tracking all domain activity and can summarize cross-mode dependencies
            whenever needed.
          </p>
        </article>
      </section>
    </PageContentContainer>
  );
}
