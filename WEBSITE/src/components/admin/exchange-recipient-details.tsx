"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ExchangeRecipientDetails({
  compact = false,
  wallet,
  institution,
  account,
  name,
}: {
  compact?: boolean;
  wallet?: boolean;
  institution?: string | null;
  account?: string | null;
  name?: string | null;
}) {
  const fields = [
    { label: "Destination institution", value: institution },
    { label: "Destination account", value: account, mono: true },
    { label: "Destination name", value: name },
  ];

  return (
    <section aria-label="Recipient details" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sky-950">
      <h3 className={cn("font-semibold", compact ? "mb-1" : "mb-2")}>Recipient details</h3>
      {wallet ? (
        <p className="text-sm text-sky-800">Pay to the customer’s TrustPay wallet.</p>
      ) : fields.some(({ value }) => Boolean(value)) ? (
        <dl className={cn("grid", compact ? "divide-y divide-sky-200" : "gap-2")}>
          {fields.map(({ label, value, mono }) => value && (
            <div key={label} className={cn("min-w-0", compact && "relative py-1 pr-11")}>
              <dt className="text-xs uppercase tracking-[0.12em] text-sky-800">{label}</dt>
              <dd className={cn("flex min-w-0 items-center justify-between gap-2", !compact && "mt-1")}>
                <span className={cn("min-w-0 wrap-anywhere text-sm font-medium", mono && "font-mono")}>{value}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("size-10 shrink-0 hover:bg-sky-100 hover:text-sky-950 focus-visible:border-sky-700 focus-visible:ring-sky-700/50", compact && "absolute top-1/2 right-0 -translate-y-1/2")}
                  aria-label={`Copy ${label.toLowerCase()}`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(value);
                      toast.success(`${label} copied`);
                    } catch {
                      toast.error(`Could not copy ${label.toLowerCase()}`);
                    }
                  }}
                >
                  <Copy aria-hidden="true" className="size-4" />
                </Button>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-sky-800">No recipient details on this request.</p>
      )}
    </section>
  );
}
