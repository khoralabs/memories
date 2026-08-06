import {
  Children,
  type ComponentType,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Tooltip } from "@/components/ui/tooltip";

export type ChromeButtonTooltipProps = React.ComponentProps<typeof Tooltip>;

export type ChromeButtonSlots = {
  icon: ReactNode[];
  tooltip: ReactElement<ChromeButtonTooltipProps> | null;
};

/** Partition icon children vs a compound `*.Tooltip` marker element. */
export function partitionChromeButtonChildren(
  children: ReactNode | undefined,
  TooltipSlot: ComponentType<ChromeButtonTooltipProps>,
): ChromeButtonSlots {
  const slots: ChromeButtonSlots = { icon: [], tooltip: null };
  if (children == null) return slots;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      if (child != null && child !== false) slots.icon.push(child);
      return;
    }
    if (child.type === TooltipSlot) {
      slots.tooltip = child as ReactElement<ChromeButtonTooltipProps>;
      return;
    }
    slots.icon.push(child);
  });
  return slots;
}

export function chromeButtonTooltipLabel(
  tooltip: ReactElement<ChromeButtonTooltipProps> | null,
  fallback: string,
): ReactNode {
  if (tooltip == null) return fallback;
  const { children } = tooltip.props;
  return children !== undefined && children !== null && children !== false ? children : fallback;
}

export function chromeButtonTooltipRootProps(
  tooltip: ReactElement<ChromeButtonTooltipProps> | null,
): Omit<ChromeButtonTooltipProps, "children"> {
  if (tooltip == null) return {};
  const { children: _children, ...rest } = tooltip.props;
  return rest;
}
