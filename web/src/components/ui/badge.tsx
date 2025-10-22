import { clsx } from "clsx";
import type * as React from "react";

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
	variant?: "default" | "secondary" | "outline";
};

const variants: Record<NonNullable<BadgeProps["variant"]>, string> = {
	default: "bg-primary text-primary-foreground hover:bg-primary/80",
	secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
	outline: "border border-input hover:bg-accent hover:text-accent-foreground",
};

const Badge: React.FC<BadgeProps> = ({
	className,
	variant = "default",
	...props
}) => (
	<div
		className={clsx(
			"inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
			variants[variant],
			className,
		)}
		{...props}
	/>
);

export { Badge };
