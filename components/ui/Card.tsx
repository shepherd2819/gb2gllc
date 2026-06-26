import { type HTMLAttributes } from "react";
import { cn } from "./cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padLg?: boolean;
  flush?: boolean;
}

export function Card({ padLg, flush, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn("ds-card", padLg && "ds-card--pad-lg", flush && "ds-card--flush", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHead({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("ds-card-head", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn("ds-card-title", className)} {...rest}>
      {children}
    </h2>
  );
}
