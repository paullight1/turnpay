"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowRight, Menu, ReceiptText, Smartphone, X, Zap } from "lucide-react";

import { TrustPayLogo } from "@/components/brand/trustpay-logo";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const services = [
  { title: "Airtime & data", detail: "Top up and stay connected.", icon: Smartphone },
  { title: "Bills & utilities", detail: "Take care of everyday bills.", icon: Zap },
  { title: "Payment records", detail: "Keep your activity clear.", icon: ReceiptText },
];

const steps = [
  {
    number: "01",
    title: "Choose a service",
    detail: "Pick airtime, data, or a bill payment.",
    image: "https://images.unsplash.com/photo-1556742502-ec7c0e9f34b1?auto=format&fit=crop&q=80&w=1200",
    alt: "A customer making a payment",
  },
  {
    number: "02",
    title: "Add your details",
    detail: "Enter the number or account for the service.",
    image: "https://images.unsplash.com/photo-1512428559087-560fa5ceab42?auto=format&fit=crop&q=80&w=1200",
    alt: "A person using a smartphone",
  },
  {
    number: "03",
    title: "Review and confirm",
    detail: "Check the details before completing your payment.",
    image: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&q=80&w=1200",
    alt: "A contactless payment at a shop",
  },
];

export function LandingPage() {
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <main className="bg-[#f8f7f4] text-[#171717]">
        <section className="relative isolate flex min-h-[80svh] flex-col overflow-hidden sm:min-h-[82svh]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute -right-32 -top-36 size-[26rem] rounded-full bg-red-100/70 blur-3xl sm:size-[38rem]" />
            <div className="absolute -bottom-48 -left-40 size-[30rem] rounded-full bg-orange-100/60 blur-3xl" />
          </div>

          <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 sm:py-7">
            <TrustPayLogo imageClassName="size-10 rounded-xl" textClassName="text-xl font-bold tracking-tight text-[#171717]" />
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="landing-menu"
              onClick={() => setMenuOpen((open) => !open)}
              className="grid size-11 place-items-center rounded-full border border-black/10 bg-white/75 text-[#242220] shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              {menuOpen ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
            </button>
            {menuOpen && (
              <nav id="landing-menu" aria-label="Main menu" className="absolute right-5 top-[calc(100%-0.25rem)] z-30 grid w-56 gap-1 rounded-2xl border border-black/10 bg-white p-2 shadow-xl sm:right-8">
                {[
                  { label: "Services", href: "#services" },
                  { label: "How it works", href: "#how-it-works" },
                  { label: "FAQ", href: "#faq" },
                ].map((item) => (
                  <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-[#45413d] transition hover:bg-[#f8f7f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
                    {item.label}
                  </a>
                ))}
                <Button
                  onClick={() => { setMenuOpen(false); setShowComingSoon(true); }}
                  className="mt-1 h-10 rounded-xl bg-red-600 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Download the app
                </Button>
              </nav>
            )}
          </header>

          <div className="mx-auto flex w-full max-w-7xl flex-1 items-center px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-16 lg:pb-28">
            <div className="max-w-4xl">
              <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-red-50 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.12em] text-red-700 sm:text-sm">
                Payments made simple
              </p>
              <h1 className="text-[clamp(3rem,11vw,6.25rem)] font-bold leading-[0.96] tracking-[-0.065em] text-[#171717]">
                Everyday payments. <span className="text-red-600">One simple app.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#66625f] sm:mt-7 sm:text-lg sm:leading-8">
                Pay bills, buy airtime and data, and take care of everyday payments with TrustPay.
              </p>
              <div className="mt-8 flex flex-col items-start gap-3 sm:mt-9 sm:flex-row sm:items-center">
                <Button
                  onClick={() => setShowComingSoon(true)}
                  className="h-13 w-full rounded-full bg-red-600 px-7 text-base font-semibold text-white shadow-lg shadow-red-600/20 hover:bg-red-700 sm:w-auto"
                >
                  Download the app
                  <ArrowRight aria-hidden="true" className="ml-2 size-5" />
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section id="services" className="bg-white px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Everyday services</p>
              <h2 className="mt-3 text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-4xl">The essentials, all in one place.</h2>
              <p className="mt-4 text-base leading-7 text-[#6c6762]">Airtime, data and utility payments are easier to manage when they’re together. TrustPay is getting ready to bring them into one simple app.</p>
            </div>
            <div className="mt-9 grid grid-cols-3 gap-2 sm:gap-4">
              {services.map((service) => {
                const Icon = service.icon;
                return (
                  <article key={service.title} className="flex min-h-36 flex-col items-center rounded-2xl border border-black/6 bg-[#faf9f7] p-2.5 text-center sm:min-h-48 sm:rounded-3xl sm:p-6">
                    <span className="grid size-16 place-items-center rounded-2xl bg-red-50 text-red-600 sm:size-16"><Icon aria-hidden="true" className="size-12 sm:size-11" strokeWidth={2.25} /></span>
                    <h3 className="mt-1.5 text-xs font-semibold leading-4 tracking-tight sm:text-base">{service.title}</h3>
                    <p className="mt-0.5 text-[10px] leading-[1.15] text-[#817b76] sm:text-xs sm:leading-4">{service.detail}</p>
                  </article>
                );
              })}
            </div>
            <div className="relative mt-8 hidden h-[22rem] overflow-hidden rounded-[1.75rem] bg-[#eee9e3] md:block lg:h-[28rem]">
              <Image
                src="https://images.unsplash.com/photo-1556742044-3c52d6e88c62?auto=format&fit=crop&q=85&w=1800"
                alt="A person using a phone to make a payment"
                fill
                unoptimized
                sizes="(min-width: 1024px) 90vw, 100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
              <p className="absolute bottom-5 left-5 max-w-sm text-xl font-semibold leading-snug text-white sm:bottom-7 sm:left-7 sm:text-2xl">Simple payments for everyday life.</p>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="bg-[#f3f1ed] px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">How it works</p>
              <h2 className="mt-3 text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-4xl">A simpler way to pay.</h2>
              <p className="mt-4 text-base leading-7 text-[#6c6762]">When TrustPay launches, you’ll be able to choose a service, enter the details, and review everything before you confirm.</p>
            </div>
            <div className="mt-9 grid gap-4 md:grid-cols-3">
              {steps.map((step) => (
                <article key={step.number} className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
                  <div className="relative aspect-[16/9] bg-[#eee9e3]">
                    <Image src={step.image} alt={step.alt} fill unoptimized sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />
                    <span className="absolute left-4 top-4 rounded-full bg-white px-3 py-1 text-xs font-bold text-red-700 shadow-sm">{step.number}</span>
                  </div>
                  <div className="p-5 sm:p-6">
                    <h3 className="text-lg font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#77716c]">{step.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="bg-white px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">FAQ</p>
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-4xl">A few things to know.</h2>
            <div className="mt-7 divide-y divide-black/10 border-y border-black/10">
              {[
                {
                  question: "When will the TrustPay app be available?",
                  answer: "The app is coming soon to iOS and Android. Use the download button and we’ll let you know when it’s ready.",
                },
                {
                  question: "What can I use TrustPay for?",
                  answer: "TrustPay is being built for everyday payments in Nigeria, including airtime, data, and utility bills.",
                },
                {
                  question: "Can I use TrustPay right now?",
                  answer: "The mobile app is not available yet. We’ll share download details when it launches.",
                },
                {
                  question: "Which phones will support the app?",
                  answer: "TrustPay is planned for both iOS and Android. More details will be shared closer to launch.",
                },
              ].map((item) => (
                <details key={item.question} className="group py-1">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-sm font-semibold text-[#242220] marker:hidden [&::-webkit-details-marker]:hidden sm:text-base">
                    {item.question}
                    <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-red-50 text-lg font-normal text-red-600 transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="max-w-2xl pb-4 pr-10 text-sm leading-6 text-[#716b66]">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#171717] px-5 py-12 text-white sm:px-8 sm:py-16">
          <div className="mx-auto flex max-w-7xl flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-300">TrustPay is coming soon</p>
              <h2 className="mt-3 text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-4xl">Everyday payments, made easier.</h2>
              <p className="mt-3 text-sm leading-6 text-white/65 sm:text-base">Airtime, data and bill payments together in one simple app.</p>
            </div>
            <Button
              onClick={() => setShowComingSoon(true)}
              className="h-12 w-full shrink-0 rounded-full bg-red-600 px-6 text-base font-semibold text-white hover:bg-red-700 sm:w-auto"
            >
              Download the app
              <ArrowRight aria-hidden="true" className="ml-2 size-5" />
            </Button>
          </div>
        </section>
      </main>

      <MarketingFooter />

      <Dialog open={showComingSoon} onOpenChange={setShowComingSoon}>
        <DialogContent className="rounded-3xl border-0 p-7 sm:p-8">
          <DialogHeader className="items-center text-center">
            <span className="mb-2 grid size-14 place-items-center rounded-2xl bg-red-50 text-red-600">
              <Smartphone aria-hidden="true" className="size-7" />
            </span>
            <DialogTitle className="text-2xl font-bold tracking-tight">The TrustPay app is coming soon</DialogTitle>
            <DialogDescription className="max-w-sm text-center text-sm leading-6">
              We’re getting the app ready for you. Check back soon for a simple way to pay bills and buy airtime and data.
            </DialogDescription>
          </DialogHeader>
          <Button onClick={() => setShowComingSoon(false)} className="mt-2 h-11 w-full rounded-full bg-red-600 text-white hover:bg-red-700">
            Got it
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
