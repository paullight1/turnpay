import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <span className="text-xl font-bold text-primary">TrustPay</span>
          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/register">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight max-w-3xl">
          Send Money. Buy Airtime. Pay Bills.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
          Exchange between GHS and NGN at competitive rates. Top up airtime, buy data, and pay cable TV and electricity bills — all in one place.
        </p>
        <div className="mt-8 flex gap-4">
          <Link href="/register">
            <Button size="lg">Create Account</Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" size="lg">Sign In</Button>
          </Link>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3 max-w-4xl">
          <div className="flex flex-col items-center gap-2">
            <span className="text-4xl">💱</span>
            <h3 className="font-semibold">Currency Exchange</h3>
            <p className="text-muted-foreground text-sm">
              Convert between GHS and NGN with transparent rates and low fees
            </p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-4xl">📱</span>
            <h3 className="font-semibold">Airtime & Data</h3>
            <p className="text-muted-foreground text-sm">
              Buy airtime and data bundles for MTN, Airtel, and Glo instantly
            </p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-4xl">⚡</span>
            <h3 className="font-semibold">Bill Payments</h3>
            <p className="text-muted-foreground text-sm">
              Pay for DStv, GOtv, StarTimes, and electricity bills seamlessly
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} TrustPay. All rights reserved.
      </footer>
    </div>
  );
}
