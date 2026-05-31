import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description: string;
  align?: "left" | "center";
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex max-w-3xl flex-col gap-3 animate-trustpay-reveal-up",
        align === "center" && "mx-auto items-center text-center",
        className
      )}
    >
      <Badge variant="secondary" className="w-fit border-white/10 bg-white/[0.06] text-orange-200">
        {eyebrow}
      </Badge>
      <h2 className="text-3xl font-semibold leading-tight text-balance md:text-5xl">
        {title}
      </h2>
      <p className="text-base leading-7 text-muted-foreground md:text-lg">
        {description}
      </p>
    </div>
  );
}
