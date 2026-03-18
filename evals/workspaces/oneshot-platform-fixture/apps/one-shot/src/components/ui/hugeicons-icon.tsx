import { createElement } from 'react';
import type { SVGProps } from 'react';

export type IconSvgElement = readonly (
  readonly [
    string,
    {
      readonly [key: string]: string | number;
    },
  ]
)[];

type HugeiconsIconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  icon: IconSvgElement;
  size?: string | number;
  color?: string;
  strokeWidth?: number;
};

export function HugeiconsIcon({
  icon,
  size = 24,
  color = 'currentColor',
  strokeWidth,
  className,
  ...rest
}: HugeiconsIconProps) {
  const strokeProps =
    strokeWidth === undefined
      ? {}
      : {
          strokeWidth,
          stroke: 'currentColor',
        };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      color={color}
      className={className}
      {...strokeProps}
      {...rest}
    >
      {icon.map(([tag, attrs], index) => {
        const elementKey = attrs.key ?? `${tag}-${index}`;
        return createElement(tag, {
          ...attrs,
          ...strokeProps,
          key: String(elementKey),
        });
      })}
    </svg>
  );
}
