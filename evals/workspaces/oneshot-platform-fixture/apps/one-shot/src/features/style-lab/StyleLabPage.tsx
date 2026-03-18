import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CapsuleButtonGroup } from "@/components/ui/capsule-button-group";
import {
  CapsuleCard,
  CapsuleCardContent,
  CapsuleCardDescription,
  CapsuleCardFooter,
  CapsuleCardHeader,
  CapsuleCardTitle,
} from "@/components/ui/capsule-card";
import { CapsuleCheckbox } from "@/components/ui/capsule-checkbox";
import { CapsuleColorSwatchSelector } from "@/components/ui/capsule-color-swatch-selector";
import { CapsuleInput } from "@/components/ui/capsule-input";
import { CapsuleSwitch } from "@/components/ui/capsule-switch";
import { CapsuleToggle } from "@/components/ui/capsule-toggle";
import {
  CapsuleTabs,
  CapsuleTabsContent,
  CapsuleTabsList,
  CapsuleTabsTrigger,
} from "@/components/ui/capsule-tabs";
import { PageContentContainer } from "@/features/app/PageContentContainer";

const SWATCHES = [
  { value: "#ef476f", label: "Bloom pink" },
  { value: "#f28482", label: "Coral milk" },
  { value: "#f59e0b", label: "Apricot pop" },
  { value: "#60a5fa", label: "Sky float" },
];

const VIEW_OPTIONS = [
  { value: "compact", label: "Compact", accent: "rgba(255, 142, 104, 0.96)" },
  { value: "comfortable", label: "Comfortable", accent: "rgba(239, 71, 111, 0.96)" },
  { value: "focus", label: "Focus", accent: "rgba(96, 165, 250, 0.96)" },
];

const GROUP_OPTIONS = [
  { value: "day", label: "Day", accent: "rgba(255, 177, 66, 0.96)" },
  { value: "week", label: "Week", accent: "rgba(239, 71, 111, 0.96)" },
  { value: "month", label: "Month", accent: "rgba(96, 165, 250, 0.96)" },
];

const ACCENTS = {
  coral: "#f97316",
  pink: "#ef476f",
  blue: "#60a5fa",
  amber: "#f59e0b",
};

const CHECKBOX_ACCENTS = [
  { label: "Blue", value: ACCENTS.blue },
  { label: "Red", value: ACCENTS.pink },
  { label: "Orange", value: ACCENTS.coral },
];

const LLM_STYLE_SUMMARY = `Capsule marker UI: use oversized pill and circle geometry, quiet warm-neutral recessed trays, and white or off-white raised markers for selected states. The swatch selector is the source of truth: controls should feel inset into a soft shell, then reveal a clean white selector, thumb, or active pill instead of turning into bright candy buttons. Lighting must stay directional, soft, and low-contrast rather than glossy or plastic.`;

function StyleSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="capsule-panel">
      <div className="flex flex-col gap-2">
        <span className="capsule-section-kicker">{eyebrow}</span>
        <div className="space-y-1">
          <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-[var(--capsule-text)]">
            {title}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-[var(--capsule-muted-text)]">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function StyleLabPage() {
  const [swatch, setSwatch] = useState(SWATCHES[0].value);
  const [view, setView] = useState(VIEW_OPTIONS[1].value);
  const [groupValue, setGroupValue] = useState(GROUP_OPTIONS[1].value);
  const [capsuleSwitch, setCapsuleSwitch] = useState(true);
  const [capsuleCheckbox, setCapsuleCheckbox] = useState(true);
  const [capsuleCheckboxRect, setCapsuleCheckboxRect] = useState(false);
  const [tabValue, setTabValue] = useState("overview");

  return (
    <PageContentContainer className="max-w-[1100px] overflow-y-auto pb-10 pr-2">
      <div className="capsule-lab min-h-max">
        <section className="capsule-hero">
          <div className="capsule-hero-copy">
            <span className="capsule-section-kicker">Capsule Candy</span>
            <h1 className="capsule-hero-title">Soft trays, vivid choices, zero reinvention of logic.</h1>
            <p className="capsule-hero-text">
              This lab keeps shadcn and Radix interaction patterns intact, then skins them with a
              tactile capsule language: oversized radii, recessed neutral shells, and candy color
              only where state deserves emphasis.
            </p>
          </div>

          <div className="capsule-manifesto">
            <div className="capsule-llm-brief">
              <p className="capsule-manifesto-label">LLM Style Definition</p>
              <p className="capsule-hero-text mt-2 text-sm leading-6">{LLM_STYLE_SUMMARY}</p>
            </div>
            <div className="capsule-manifesto-grid">
              <div>
                <p className="capsule-manifesto-label">Shape</p>
                <p className="capsule-manifesto-copy">Perfect circles, deep pills, no sharp edges.</p>
              </div>
              <div>
                <p className="capsule-manifesto-label">Surface</p>
                <p className="capsule-manifesto-copy">Matte trays with inset depth and low-contrast framing.</p>
              </div>
              <div>
                <p className="capsule-manifesto-label">State</p>
                <p className="capsule-manifesto-copy">Quiet by default, saturated only for selection and emphasis.</p>
              </div>
              <div>
                <p className="capsule-manifesto-label">Mood</p>
                <p className="capsule-manifesto-copy">Tactile, polished, modern, a little playful.</p>
              </div>
            </div>
          </div>
        </section>

        <StyleSection
          eyebrow="Anchor Component"
          title="Rebuilt Color Swatch Selector"
          description="This rebuild uses the same accessible radio-group technique as the rest of the family. The tray is thicker, the spacing is tighter, and the selected white center mark is more deliberate so the control reads like a refined object rather than a generic chip list."
        >
          <div className="capsule-demo-card">
            <CapsuleColorSwatchSelector.Root
              value={swatch}
              onValueChange={setSwatch}
              aria-label="Choose palette color"
            >
              <CapsuleColorSwatchSelector.Label>Select color</CapsuleColorSwatchSelector.Label>
              <CapsuleColorSwatchSelector.Content>
                {SWATCHES.map((item) => (
                  <CapsuleColorSwatchSelector.Item
                    key={item.value}
                    value={item.value}
                    swatch={item.value}
                    label={item.label}
                  />
                ))}
              </CapsuleColorSwatchSelector.Content>
            </CapsuleColorSwatchSelector.Root>

            <div className="capsule-caption-row">
              <Badge variant="capsule">{SWATCHES.find((item) => item.value === swatch)?.label}</Badge>
              <span className="capsule-caption-copy">Color lives in the swatches, while selection is communicated by a restrained white marker.</span>
            </div>
          </div>
        </StyleSection>

        <StyleSection
          eyebrow="Controls"
          title="Toggle, Switch, and Checkbox"
          description="Selection controls should all behave like white markers nested inside a recessed tray. The segmented toggle is the direct translation of the swatch selector into text, while switch and checkbox keep the same quiet shell language."
        >
          <div className="capsule-demo-card">
            <CapsuleToggle
              value={view}
              onValueChange={setView}
              options={VIEW_OPTIONS}
              aria-label="Choose content density"
            />
            <div className="capsule-controls-grid">
              <label className="capsule-field-row">
                <div>
                  <p className="capsule-field-label">Realtime sync</p>
                  <p className="capsule-field-hint">Binary state with a restrained tray and a soft white thumb.</p>
                </div>
                <CapsuleSwitch
                  checked={capsuleSwitch}
                  onCheckedChange={setCapsuleSwitch}
                  accent={ACCENTS.blue}
                />
              </label>
              <label className="capsule-field-row">
                <div>
                  <p className="capsule-field-label">Auto-approve drafts</p>
                  <p className="capsule-field-hint">Checkboxes use the same swatch shell language, then reveal a white center pod only when selected.</p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <CapsuleCheckbox
                    checked={capsuleCheckbox}
                    onCheckedChange={(checked) => setCapsuleCheckbox(checked === true)}
                    accent={ACCENTS.blue}
                    aria-label="Rounded checkbox example"
                  />
                  <CapsuleCheckbox
                    checked={capsuleCheckboxRect}
                    onCheckedChange={(checked) => setCapsuleCheckboxRect(checked === true)}
                    accent={ACCENTS.coral}
                    variant="rectangular"
                    aria-label="Rectangular checkbox example"
                  />
                </div>
              </label>
            </div>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <p className="capsule-field-label">Rounded Variant</p>
                <div className="flex flex-wrap items-center gap-3">
                  <CapsuleCheckbox checked={false} aria-label="Rounded checkbox unchecked example" />
                  {CHECKBOX_ACCENTS.map((accent) => (
                    <CapsuleCheckbox
                      key={`rounded-${accent.label}`}
                      checked
                      accent={accent.value}
                      aria-label={`Rounded checkbox ${accent.label.toLowerCase()} example`}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="capsule-field-label">Rectangular Variant</p>
                <div className="flex flex-wrap items-center gap-3">
                  <CapsuleCheckbox checked={false} variant="rectangular" aria-label="Rectangular checkbox unchecked example" />
                  {CHECKBOX_ACCENTS.map((accent) => (
                    <CapsuleCheckbox
                      key={`rectangular-${accent.label}`}
                      checked
                      variant="rectangular"
                      accent={accent.value}
                      aria-label={`Rectangular checkbox ${accent.label.toLowerCase()} example`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="capsule-caption-row">
              <Badge variant="capsule-accent">
                {VIEW_OPTIONS.find((item) => item.value === view)?.label}
              </Badge>
              <span className="capsule-caption-copy">The active segment should read like a white selector resting inside the same shell as the swatches.</span>
            </div>
          </div>
        </StyleSection>

        <StyleSection
          eyebrow="Actions"
          title="Buttons and Button Group"
          description="Buttons and grouped actions should stay warm, quiet, and slightly recessed. The selected state should become a white raised pill rather than a brightly colored chip."
        >
          <div className="capsule-demo-card">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="capsule">Preview Flow</Button>
              <Button
                variant="capsule-accent"
                style={{ ["--capsule-button-accent" as string]: ACCENTS.pink }}
              >
                Deploy Capsule
              </Button>
              <Button variant="capsule-ghost">Secondary Action</Button>
            </div>
            <CapsuleButtonGroup
              value={groupValue}
              onValueChange={(value: string) => value && setGroupValue(value)}
              options={GROUP_OPTIONS}
              aria-label="Choose reporting range"
            />
          </div>
        </StyleSection>

        <StyleSection
          eyebrow="Layout"
          title="Cards, Tabs, and Inputs"
          description="Foundational surfaces should stay low-contrast and tactile. Cards are quiet trays, tabs use white selected pills inside a calm rail, and fields feel gently recessed rather than boxed in."
        >
          <div className="capsule-demo-card">
            <CapsuleTabs value={tabValue} onValueChange={setTabValue}>
              <CapsuleTabsList style={{ ["--capsule-tabs-accent" as string]: ACCENTS.blue }}>
                <CapsuleTabsTrigger value="overview">Overview</CapsuleTabsTrigger>
                <CapsuleTabsTrigger value="automation">Automation</CapsuleTabsTrigger>
                <CapsuleTabsTrigger value="qa">QA</CapsuleTabsTrigger>
              </CapsuleTabsList>
              <CapsuleTabsContent value="overview">
                <CapsuleCard>
                  <CapsuleCardHeader>
                    <div className="capsule-card-heading">
                      <div>
                        <CapsuleCardTitle>Deployment Capsule</CapsuleCardTitle>
                        <CapsuleCardDescription>
                          Soft trays, low-contrast structure, and emphasis only where state matters.
                        </CapsuleCardDescription>
                      </div>
                      <Badge
                        variant="capsule-status"
                        style={{ ["--capsule-badge-status" as string]: ACCENTS.blue }}
                      >
                        Healthy
                      </Badge>
                    </div>
                  </CapsuleCardHeader>
                  <CapsuleCardContent>
                    <div className="capsule-card-form">
                      <label className="capsule-input-stack">
                        <span className="capsule-field-label">Project Name</span>
                        <CapsuleInput defaultValue="One Shot Capsule Kit" />
                      </label>
                      <div className="flex flex-wrap items-center gap-3">
                        <Badge variant="capsule">Neutral Capsule</Badge>
                        <Badge
                          variant="capsule-accent"
                          style={{ ["--capsule-badge-accent" as string]: ACCENTS.pink }}
                        >
                          Selected Style
                        </Badge>
                        <Badge
                          variant="capsule-status"
                          style={{ ["--capsule-badge-status" as string]: ACCENTS.amber }}
                        >
                          Ready to Extend
                        </Badge>
                      </div>
                    </div>
                  </CapsuleCardContent>
                  <CapsuleCardFooter>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button variant="capsule-ghost">Save Draft</Button>
                      <Button
                        variant="capsule-accent"
                        style={{ ["--capsule-button-accent" as string]: ACCENTS.blue }}
                      >
                        Ship Update
                      </Button>
                    </div>
                  </CapsuleCardFooter>
                </CapsuleCard>
              </CapsuleTabsContent>
              <CapsuleTabsContent value="automation">
                <div className="capsule-tab-copy">
                  Same shell language should hold for settings panes and lightweight forms.
                </div>
              </CapsuleTabsContent>
              <CapsuleTabsContent value="qa">
                <div className="capsule-tab-copy">
                  Checks should feel calm and structured, not louder than the actions they support.
                </div>
              </CapsuleTabsContent>
            </CapsuleTabs>
          </div>
        </StyleSection>
      </div>
    </PageContentContainer>
  );
}
