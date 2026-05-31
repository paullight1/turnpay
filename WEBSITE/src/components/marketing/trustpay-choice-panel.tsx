"use client";

import { useState } from "react";
import { FileText, Landmark, MessageCircle, ReceiptText, Smartphone, WalletCards, Zap } from "lucide-react";

const choices = [
  {
    icon: FileText,
    label: "Wallet reports",
    title: "See wallet activity without guessing.",
    text: "Track balances, exchange quotes, VTU orders, fees, and receipts in one clear timeline.",
    bullets: ["NGN and GHS wallet history", "Receipts tied to every reference"],
    visual: "wallet",
  },
  {
    icon: Zap,
    label: "Quick payments",
    title: "Move faster from quote to confirmation.",
    text: "Start exchange, airtime, data, and bill payments with fewer steps and clearer review screens.",
    bullets: ["Fast VTU and utility flow", "Review amount and fee first"],
    visual: "payments",
  },
  {
    icon: Landmark,
    label: "Bank ready",
    title: "Keep funding and withdrawal paths clear.",
    text: "Use trusted bank rails, virtual accounts, and support-ready records for smoother wallet movement.",
    bullets: ["Virtual account visibility", "Withdrawal status tracking"],
    visual: "banks",
  },
  {
    icon: MessageCircle,
    label: "Support proof",
    title: "Resolve issues with the right details.",
    text: "Every transaction keeps the status, reference, and receipt context support needs to help quickly.",
    bullets: ["Reference-first support", "Pending and reversed states"],
    visual: "support",
  },
];

function ChoiceVisual({ visual }: { visual: string }) {
  if (visual === "payments") {
    return (
      <div className="mt-5 grid h-44 place-items-center rounded-lg bg-orange-500/10 p-4">
        <div className="relative grid size-28 place-items-center rounded-[2rem] border border-orange-300/30 bg-black text-orange-300">
          <Smartphone aria-hidden="true" className="size-12" />
          <span className="absolute -left-6 top-4 rounded-full bg-orange-500 px-3 py-1 text-xs font-black text-white">Data</span>
          <span className="absolute -right-7 top-12 rounded-full bg-white px-3 py-1 text-xs font-black text-black">Bills</span>
          <span className="absolute bottom-1 right-3 grid size-9 place-items-center rounded-full bg-orange-500 text-white">
            <Zap aria-hidden="true" className="size-5" />
          </span>
        </div>
      </div>
    );
  }

  if (visual === "banks") {
    return (
      <div className="mt-5 h-44 rounded-lg bg-orange-500/10 p-4">
        <div className="grid h-full content-center gap-3">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-orange-500 text-white">
            <Landmark aria-hidden="true" className="size-9" />
          </div>
          {["Virtual account", "Bank transfer", "Withdrawal ready"].map((item) => (
            <div key={item} className="flex items-center justify-between rounded-full bg-black/70 px-4 py-2 text-xs text-white/76">
              <span>{item}</span>
              <span className="size-2 rounded-full bg-orange-400" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (visual === "support") {
    return (
      <div className="mt-5 grid h-44 content-center gap-3 rounded-lg bg-orange-500/10 p-4">
        <div className="w-4/5 rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-xs font-semibold text-black">
          Ref: TP-2048 found
        </div>
        <div className="ml-auto w-4/5 rounded-2xl rounded-br-sm bg-orange-500 px-4 py-3 text-xs font-semibold text-white">
          Receipt sent
        </div>
        <div className="mx-auto mt-1 grid size-12 place-items-center rounded-full bg-black text-orange-300">
          <MessageCircle aria-hidden="true" className="size-6" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 h-44 rounded-lg bg-orange-500/10 p-4">
      <div className="grid h-full grid-cols-[1fr_1.2fr] items-center gap-3">
        <div className="grid gap-3">
          {["NGN", "GHS"].map((item) => (
            <div key={item} className="rounded-xl bg-black/70 p-3">
              <p className="text-xs text-white/42">{item}</p>
              <p className="mt-1 text-sm font-black text-white">{item === "NGN" ? "₦338k" : "GH₵4.8k"}</p>
            </div>
          ))}
        </div>
        <div className="grid place-items-center rounded-2xl bg-orange-500 p-4 text-white">
          <WalletCards aria-hidden="true" className="size-12" />
          <ReceiptText aria-hidden="true" className="-mt-3 ml-10 size-8 rounded-lg bg-black p-1.5" />
        </div>
      </div>
    </div>
  );
}

export function TrustpayChoicePanel() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = choices[selectedIndex];
  const Icon = selected.icon;

  return (
    <div className="mx-auto mt-9 max-w-5xl rounded-xl border border-white/8 bg-[#1a1a1a] p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {choices.map((choice, index) => {
          const ChoiceIcon = choice.icon;
          const isSelected = selectedIndex === index;

          return (
            <button
              key={choice.label}
              type="button"
              onClick={() => setSelectedIndex(index)}
              className={`rounded-lg border p-4 text-left text-sm font-semibold transition-all ${
                isSelected
                  ? "border-orange-400/70 bg-orange-500 text-white shadow-[0_0_32px_rgba(255,107,10,0.18)]"
                  : "border-white/8 bg-black/60 text-white hover:border-orange-300/50 hover:bg-white/[0.06]"
              }`}
            >
              <ChoiceIcon aria-hidden="true" className={`mb-3 size-5 ${isSelected ? "text-white" : "text-orange-300"}`} />
              {choice.label}
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-[1fr_1fr] md:items-center">
        <div className="rounded-lg border border-white/8 bg-[#080908] p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-white/42">TrustPay focus</p>
              <p className="mt-1 text-sm font-semibold text-white">{selected.label}</p>
            </div>
            <span className="grid size-10 place-items-center rounded-full bg-orange-500 text-white">
              <Icon aria-hidden="true" className="size-5" />
            </span>
          </div>
          <ChoiceVisual visual={selected.visual} />
        </div>
        <div>
          <h3 className="text-2xl font-bold text-white">{selected.title}</h3>
          <p className="mt-3 text-sm leading-6 text-white/52">{selected.text}</p>
          <div className="mt-5 space-y-3 text-sm text-white/72">
            {selected.bullets.map((item) => (
              <p key={item} className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-orange-400" />
                {item}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
