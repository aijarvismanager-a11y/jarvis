import React from "react";

export type ChipTone = "neutral" | "ok" | "warn" | "accent";

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  dot?: boolean;
}

export function Chip({
  tone = "neutral",
  dot = true,
  className,
  children,
  onClick,
  onKeyDown,
  ...rest
}: ChipProps) {
  const classes = ["v2-chip", `v2-chip--${tone}`, className].filter(Boolean).join(" ");

  // Clickable chips (category filters, toggles) need to be reachable and
  // operable by keyboard too — a bare <span onClick> is invisible to Tab
  // navigation and screen readers.
  const interactiveProps = onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent<HTMLSpanElement>) => {
          onKeyDown?.(e);
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(e as unknown as React.MouseEvent<HTMLSpanElement>);
          }
        },
      }
    : { onKeyDown };

  return (
    <span className={classes} onClick={onClick} {...interactiveProps} {...rest}>
      {dot && <span className="v2-chip__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
