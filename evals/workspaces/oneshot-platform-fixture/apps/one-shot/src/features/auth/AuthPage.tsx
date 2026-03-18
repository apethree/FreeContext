import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { ArrowRight } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HoverExpand_002 } from "@/components/ui/skiper-ui/skiper53";
import { OneShotLogo } from "@/features/app/OneShotLogo";
import { cn } from "@/lib/utils";
import { SignInPanel } from "@/features/auth/SignInPanel";
import { SignUpPanel } from "@/features/auth/SignUpPanel";
import { AutoSignIn } from "@/features/auth/AutoSignIn";

type AuthMode = "sign-in" | "sign-up";
type HeroTabId =
  | "mobile_app"
  | "launch_startup"
  | "automation"
  | "marketplace"
  | "saas"
  | "ai_product";

const HERO_TABS: Array<{ id: HeroTabId; label: string; imageSrc?: string }> = [
  { id: "mobile_app", label: "Mobile App", imageSrc: "/ios_transparent.png" },
  { id: "launch_startup", label: "Launch startup" },
  { id: "automation", label: "Automation" },
  { id: "marketplace", label: "Marketplace" },
  { id: "saas", label: "SaaS" },
  { id: "ai_product", label: "AI product" },
];

export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [activePanel, setActivePanel] = useState(0);
  const [activeHeroTab, setActiveHeroTab] = useState<HeroTabId>("mobile_app");
  const [isCompactHeight, setIsCompactHeight] = useState(false);
  const [isTinyHeight, setIsTinyHeight] = useState(false);
  const [isSystemDark, setIsSystemDark] = useState(false);
  const [autoSignInFallback, setAutoSignInFallback] = useState(false);
  const [panelHeights, setPanelHeights] = useState({
    collapsed: 64,
    expanded: 620,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncPanelHeights = () => {
      const viewportHeight = window.innerHeight;
      const compactHeight = viewportHeight <= 520;
      const tinyHeight = viewportHeight <= 440;
      const topInset = viewportHeight >= 768 ? 64 : compactHeight ? 20 : 42;
      const bottomInset = viewportHeight >= 768 ? 18 : compactHeight ? 4 : 8;
      const gap = viewportHeight >= 768 ? 8 : compactHeight ? 4 : 6;
      const collapsed = Math.max(
        compactHeight ? 34 : 48,
        Math.min(
          compactHeight ? 56 : 78,
          Math.round(
            viewportHeight *
              (viewportHeight >= 768 ? 0.085 : compactHeight ? 0.06 : 0.072),
          ),
        ),
      );
      const expanded = Math.max(
        compactHeight ? 180 : 220,
        Math.min(
          780,
          Math.round(viewportHeight - topInset - bottomInset - gap - collapsed),
        ),
      );
      setIsCompactHeight(compactHeight);
      setIsTinyHeight(tinyHeight);
      setPanelHeights({ collapsed, expanded });
    };

    const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => setIsSystemDark(themeMedia.matches);

    syncPanelHeights();
    syncTheme();
    window.addEventListener("resize", syncPanelHeights);
    themeMedia.addEventListener("change", syncTheme);
    return () => {
      window.removeEventListener("resize", syncPanelHeights);
      themeMedia.removeEventListener("change", syncTheme);
    };
  }, []);

  const activeHeroConfig = HERO_TABS.find((tab) => tab.id === activeHeroTab);

  const marketingPanelContent = (
    <div
      className={cn(
        "relative flex h-full w-full flex-col justify-between overflow-hidden",
        isCompactHeight
          ? "gap-1.5 px-3 py-2 sm:gap-2 sm:px-4 sm:py-3"
          : "gap-4 px-6 py-6 md:px-8 md:py-7",
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[url('/clay-court.png')] bg-cover bg-center" />
      <div className="pointer-events-none absolute inset-0 bg-black/45" />

      <div
        className={cn(
          "relative z-10 flex flex-1 flex-col items-center text-center",
          isCompactHeight ? "justify-start pt-0.5" : "justify-center",
        )}
      >
        <h1
          className={cn(
            "font-semibold leading-[0.95] tracking-[-0.045em] text-white",
            isCompactHeight
              ? "text-[clamp(1.7rem,5.1vw,2.6rem)]"
              : "text-[clamp(2.5rem,6.2vw,5.25rem)]",
          )}
        >
          One shot
        </h1>
        {!isTinyHeight ? (
          <p
            className={cn(
              "max-w-2xl text-white",
              isCompactHeight
                ? "mt-1 text-[11px] leading-tight sm:text-xs"
                : "mt-4 text-[clamp(1rem,1.6vw,1.2rem)]",
            )}
          >
            From idea to production in one shot.
          </p>
        ) : null}

        <div
          className={cn(
            "relative mt-1.5 flex min-h-0 flex-1 items-center justify-center",
          )}
        >
          <div
            className={cn(
              "grid w-full items-center",
              isCompactHeight
                ? "max-w-[460px] grid-cols-[112px_minmax(0,220px)_112px] gap-1.5"
                : "max-w-[620px] grid-cols-[132px_minmax(0,320px)_132px] gap-2.5",
            )}
          >
            <div className="flex w-full flex-col items-center justify-center gap-1.5">
              {HERO_TABS.map((tab) => {
                const isActive = tab.id === activeHeroTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveHeroTab(tab.id)}
                    className={cn(
                      "relative inline-flex h-7 w-full items-center justify-center rounded-full px-2 text-center font-medium transition-colors sm:h-8",
                      isCompactHeight ? "text-[11px] sm:text-xs" : "text-sm",
                      isActive
                        ? "text-white"
                        : "text-white/62 hover:bg-white/10 hover:text-white/88",
                    )}
                  >
                    {isActive ? (
                      <motion.span
                        layoutId="hero-tab-active"
                        className="absolute inset-0 rounded-full bg-white/13 ring-1 ring-white/25"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    ) : null}
                    <span className="relative z-10 whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="relative min-h-0 flex items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeHeroTab}
                  initial={{ opacity: 0, y: 10, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.985 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="flex h-full w-full items-center justify-center"
                >
                  {activeHeroConfig?.imageSrc ? (
                    <img
                      src={activeHeroConfig.imageSrc}
                      alt="Feature preview"
                      className={cn(
                        "w-auto select-none",
                        isTinyHeight
                          ? "h-[min(25vh,115px)]"
                          : isCompactHeight
                            ? "h-[min(30vh,145px)]"
                            : "h-[min(44vh,430px)]",
                      )}
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span
                        className={cn(
                          "font-medium text-white/75",
                          isCompactHeight ? "text-[11px]" : "text-sm",
                        )}
                      >
                        Coming soon
                      </span>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <div aria-hidden className="w-full" />
          </div>
        </div>
      </div>

      <div
        className={cn(
          "relative z-10 flex items-center",
          isCompactHeight ? "mt-1 justify-center" : "mt-2 justify-end",
        )}
      >
        <Button
          size="default"
          type="button"
          onClick={() => setActivePanel(1)}
          className={cn(
            "rounded-full bg-white font-semibold text-neutral-950 hover:bg-white/90",
            isCompactHeight
              ? "h-8 px-3 text-sm sm:h-9 sm:px-4 sm:text-base"
              : "h-11 px-5 text-lg md:h-12 md:px-6 md:text-xl",
          )}
        >
          Get started
          <HugeiconsIcon
            icon={ArrowRight}
            className={cn(
              "!text-neutral-950",
              isCompactHeight ? "ml-1.5 h-4 w-4 sm:h-5 sm:w-5" : "ml-2 h-6 w-6",
            )}
          />
        </Button>
      </div>
    </div>
  );

  const marketingCollapsedContent = (
    <>
      <div className="pointer-events-none absolute inset-0 bg-[url('/clay-court.png')] bg-cover bg-center" />
      <div className="pointer-events-none absolute inset-0 bg-black/45" />
    </>
  );

  const signInPanelContent = (
    <div
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-center overflow-y-auto",
        isCompactHeight
          ? "px-2.5 py-1.5 sm:px-3 sm:py-2"
          : "px-3 py-2 sm:px-4 sm:py-3 md:px-6 md:py-4",
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[url('/grass-court.png')] bg-cover bg-center" />
      <div className="pointer-events-none absolute inset-0 bg-black/35" />

      <div
        className={cn(
          "relative z-10 flex w-full flex-col items-center",
          isCompactHeight
            ? "my-0 gap-1"
            : "my-auto gap-[clamp(0.4rem,1.25vh,1.15rem)]",
        )}
      >
        <OneShotLogo
          aria-label="One Shot"
          role="img"
          className={cn(
            "w-auto select-none",
            isTinyHeight
              ? "h-6"
              : isCompactHeight
                ? "h-8 sm:h-9"
                : "h-10 sm:h-11 md:h-14",
          )}
        />

        <Card
          className={cn(
            "w-full overflow-hidden rounded-[32px] p-0 shadow-[0_24px_80px_-46px_rgba(2,6,23,0.65)]",
            isSystemDark
              ? "border-white/12 bg-neutral-950/82 text-neutral-100"
              : "border-white/15 bg-white/96 text-neutral-900",
            isCompactHeight ? "max-w-[21rem]" : "max-w-[25.5rem]",
          )}
        >
          <CardHeader
            className={cn(
              "text-center",
              isTinyHeight
                ? "pb-0.5 pt-2"
                : isCompactHeight
                  ? "pb-1 pt-2.5"
                  : "pb-2 pt-4 sm:pb-3 sm:pt-5",
            )}
          >
            <CardTitle
              className={cn(
                "font-semibold tracking-tight",
                isCompactHeight ? "text-base" : "text-lg",
              )}
            >
              {mode === "sign-in" ? "Sign in to One Shot" : "Create your account"}
            </CardTitle>
          </CardHeader>

          <CardContent
            className={cn(
              "mx-auto w-full pt-0",
              isTinyHeight
                ? "max-w-[16rem] pb-1.5"
                : isCompactHeight
                  ? "max-w-[16.5rem] pb-2.5"
                  : "max-w-[19.5rem] pb-4 sm:max-w-sm sm:pb-5",
            )}
          >
            {mode === "sign-in" ? (
              <SignInPanel
                onSignedIn={() => setMode("sign-in")}
                compact={isCompactHeight}
              />
            ) : (
              <SignUpPanel
                onSignedIn={() => setMode("sign-in")}
                compact={isCompactHeight}
              />
            )}
          </CardContent>

          <CardFooter
            className={cn(
              "flex h-10 items-center justify-center border-t px-2 text-center [.border-t]:!pt-0",
              isSystemDark
                ? "border-white/10 bg-neutral-900/88 text-neutral-300"
                : "border-neutral-200/80 bg-neutral-100 text-neutral-500",
              isCompactHeight ? "py-0" : "py-0",
            )}
          >
            <span
              className={cn(
                "inline-flex h-full items-center justify-center",
                isCompactHeight ? "text-[11px] leading-none" : "text-sm leading-none",
              )}
            >
              {mode === "sign-in"
                ? "Don't have an account? "
                : "Already have an account? "}
              <button
                type="button"
                onClick={() =>
                  setMode(mode === "sign-in" ? "sign-up" : "sign-in")
                }
                className={cn(
                  "font-semibold hover:underline",
                  isSystemDark ? "text-neutral-100" : "text-neutral-700",
                )}
              >
                {mode === "sign-in" ? "Sign up" : "Sign in"}
              </button>
            </span>
          </CardFooter>
        </Card>

        <p
          className={cn(
            "text-center leading-tight text-white/90",
            isTinyHeight
              ? "text-[8px]"
              : isCompactHeight
                ? "text-[9px]"
                : "text-[10px] sm:text-[11px]",
          )}
        >
          By clicking continue, you agree to our{" "}
          <a
            href="https://capzero.com/terms-of-service"
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              "font-medium underline underline-offset-2",
              isSystemDark
                ? "text-neutral-100 hover:text-neutral-200"
                : "text-white hover:text-white/85",
            )}
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href="https://capzero.com/privacy-policy"
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              "font-medium underline underline-offset-2",
              isSystemDark
                ? "text-neutral-100 hover:text-neutral-200"
                : "text-white hover:text-white/85",
            )}
          >
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );

  const signInCollapsedContent = (
    <>
      <div className="pointer-events-none absolute inset-0 bg-[url('/grass-court.png')] bg-cover bg-center" />
      <div className="pointer-events-none absolute inset-0 bg-black/35" />
    </>
  );

  const panels = useMemo(
    () => [
      {
        id: "marketing",
        collapsedLabel: "One Shot",
        collapsedHint: "Explore",
        content: marketingPanelContent,
        collapsedContent: marketingCollapsedContent,
      },
      {
        id: "signin",
        collapsedLabel: "Start building →",
        collapsedHint: null,
        content: signInPanelContent,
        collapsedContent: signInCollapsedContent,
      },
    ],
    [
      marketingPanelContent,
      signInPanelContent,
      marketingCollapsedContent,
      signInCollapsedContent,
    ],
  );

  return (
    <div
      className={cn(
        "relative h-[100dvh] overflow-hidden",
        isSystemDark ? "bg-[#080d16] text-neutral-100" : "bg-[#edf2fa] text-neutral-900",
      )}
    >
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background: isSystemDark
              ? "radial-gradient(circle at 46% 10%,rgba(30,64,175,0.28),transparent 48%),radial-gradient(circle at 16% 82%,rgba(37,99,235,0.2),transparent 44%),radial-gradient(circle at 84% 20%,rgba(16,185,129,0.17),transparent 48%),radial-gradient(circle at 52% 94%,rgba(21,94,117,0.34),transparent 52%)"
              : "radial-gradient(circle_at_50%_12%,rgba(194,65,12,0.42),transparent_52%),radial-gradient(circle_at_12%_18%,rgba(249,115,22,0.35),transparent_54%),radial-gradient(circle_at_52%_92%,rgba(22,163,74,0.56),transparent_62%),radial-gradient(circle_at_86%_20%,rgba(37,99,235,0.24),transparent_56%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: isSystemDark
              ? "linear-gradient(145deg,rgba(255,255,255,0.06),rgba(15,23,42,0.26) 42%,rgba(2,6,23,0.56))"
              : "linear-gradient(145deg,rgba(255,255,255,0.46),rgba(255,255,255,0)_40%,rgba(15,23,42,0.12))",
          }}
        />
      </div>

      <SignedIn>
        <Navigate to="/home" replace />
      </SignedIn>

      <SignedOut>
        {!autoSignInFallback ? (
          <AutoSignIn onFallback={() => setAutoSignInFallback(true)} />
        ) : (
          <div
            className={cn(
              "relative z-10 flex h-full w-full items-start justify-center",
              isCompactHeight
                ? "px-2 pb-0.5 pt-3"
                : "px-3 pb-1 pt-10 sm:px-4 sm:pt-11 md:px-8 md:pb-4 md:pt-16",
            )}
          >
            <HoverExpand_002
              items={panels}
              activeIndex={activePanel}
              onActiveIndexChange={setActivePanel}
              collapsedHeight={panelHeights.collapsed}
              expandedHeight={panelHeights.expanded}
              className={cn(
                "w-full",
                isCompactHeight ? "max-w-[94vw]" : "max-w-5xl",
              )}
              panelClassName={cn(
                "shadow-[0_30px_90px_-55px_rgba(0,0,0,0.95)] backdrop-blur-xl",
                isSystemDark
                  ? "border-white/12 bg-white/[0.04]"
                  : "border-white/15 bg-white/[0.06]",
              )}
            />
          </div>
        )}
      </SignedOut>
    </div>
  );
}
