import { type FC, useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import { useIsMarkdownCodeBlock } from '@assistant-ui/react-markdown';
import { cn } from '@/lib/utils';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
});

/**
 * Renders a Mermaid diagram inside a code block.
 * Only renders when the code block is complete (not mid-stream)
 * to avoid failed parses on partial diagram syntax.
 */
export const MermaidDiagram: FC<SyntaxHighlighterProps> = ({ components }) => {
  const isCodeBlock = useIsMarkdownCodeBlock();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const uniqueId = useId().replace(/:/g, '-');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCodeBlock) return;
    const code = wrapperRef.current?.querySelector('code')?.textContent?.trim();
    if (!code) return;

    let cancelled = false;

    (async () => {
      try {
        const { svg: rendered } = await mermaid.render(`mermaid-${uniqueId}`, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError(null);
          setSvg(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isCodeBlock, uniqueId]);

  if (!isCodeBlock) {
    return (
      <components.Pre>
        <components.Code />
      </components.Pre>
    );
  }

  return (
    <div className="my-2">
      {/* Hidden code element for text extraction */}
      <div ref={wrapperRef} className="hidden">
        <components.Pre>
          <components.Code />
        </components.Pre>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          Failed to render diagram
        </div>
      )}

      {svg && (
        <div
          className={cn(
            'overflow-x-auto rounded-lg border border-border/50 bg-background p-4',
            '[&_svg]:mx-auto [&_svg]:max-w-full',
          )}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
};
