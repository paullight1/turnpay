import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description: string;
  align?: "left" | "center";
  tone?: "light" | "dark";
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  tone = "light",
  className,
}: SectionHeadingProps) {
  const isDark = tone === "dark";

  return (
    <div
      className={cn(
        "flex max-w-3xl flex-col gap-3 animate-trustpay-reveal-up",
        align === "center" && "mx-auto items-center text-center",
        className
      )}
    >
      <Badge
        variant="secondary"
        className={
          isDark
            ? "w-fit border-white/10 bg-white/[0.06] text-red-200"
            : "w-fit border-red-100 bg-red-50 text-red-700"
        }
      >
        {eyebrow}
      </Badge>
      <h2
        className={cn(
          "text-3xl font-semibold leading-tight text-balance md:text-5xl",
          isDark ? "text-white" : "text-foreground",
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          "text-base leading-7 md:text-lg",
          isDark ? "text-white/65" : "text-muted-foreground",
        )}
      >
        {description}
      </p>
    </div>
  );
}
