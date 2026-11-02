"use client";

import { hasAdminAccess } from "@/lib/admin-access";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-provider";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TrustPayLogo } from "@/components/brand/trustpay-logo";
import { AdminNotificationBell } from "@/components/admin/admin-notification-bell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { maskEmail } from "@/lib/privacy";
import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  ClipboardList,
  FileCheck2,
  Landmark,
  LifeBuoy,
  Menu,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  LogOut,
  Smartphone,
  Send,
  UserRound,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: BarChart3 },
  { label: "Fund", href: "/dashboard/fund", icon: Banknote },
  { label: "Send", href: "/dashboard/send", icon: Send },
  { label: "Withdraw to bank", href: "/dashboard/withdraw", icon: Landmark },
  { label: "Exchange", href: "/dashboard/exchange", icon: ArrowLeftRight },
  { label: "VTU", href: "/dashboard/vtu", icon: Smartphone },
  {
    label: "Transactions",
    href: "/dashboard/transactions",
    icon: ClipboardList,
  },
  { label: "KYC", href: "/dashboard/kyc", icon: BadgeCheck },
  { label: "Support", href: "/dashboard/support", icon: LifeBuoy },
  { label: "Profile", href: "/dashboard/profile", icon: UserRound },
];

const adminItems: NavItem[] = [
  { label: "Overview", href: "/admin", icon: ShieldCheck },
  {
    label: "Funding review",
    href: "/admin/payments/adverse-funding",
    icon: ShieldAlert,
  },
  { label: "Transactions", href: "/admin?tab=finance", icon: BarChart3 },
  { label: "Customers", href: "/admin?tab=users", icon: UserRound },
  {
    label: "Exchange requests",
    href: "/admin/exchange/manual-orders",
    icon: ArrowLeftRight,
  },
  { label: "Audit Trail", href: "/admin/audit", icon: ScrollText },
  { label: "VTU oversight", href: "/admin/vtu", icon: Smartphone },
  { label: "Exchange rates", href: "/admin?tab=exchange", icon: Banknote },
  { label: "Customer support", href: "/admin/support", icon: LifeBuoy },
  { label: "KYC Review", href: "/admin/kyc", icon: FileCheck2 },
];

function Sidebar({
  items,
  pathname,
  onNavigate,
  admin = false,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  admin?: boolean;
}) {
  const searchParams = useSearchParams();
  return (
    <nav
      className="flex flex-col gap-1.5 p-3"
      aria-label={admin ? "Admin navigation" : "Dashboard navigation"}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const itemUrl = new URL(item.href, 'https://trustpay.invalid');
        const active = pathname === itemUrl.pathname &&
          (itemUrl.searchParams.get('tab') ?? 'ops') === (searchParams.get('tab') ?? 'ops');

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group/nav relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
              active
                ? "bg-red-600 text-white shadow-sm shadow-red-950/30 after:absolute after:-left-3 after:top-1/2 after:h-6 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-red-400"
                : "text-white/58 hover:translate-x-1 hover:bg-white/[0.06] hover:text-white",
            )}
          >
            <Icon className="size-4 transition-transform group-hover/nav:scale-110" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, signOut, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartY = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const adminWorkspace =
    pathname === "/admin" || pathname.startsWith("/admin/");
  const staffAccount = hasAdminAccess(user);
  const redirectingStaff = staffAccount && !adminWorkspace;

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace(adminWorkspace ? "/staff" : "/login");
    } else if (!isLoading && redirectingStaff) {
      router.replace("/admin");
    }
  }, [user, isLoading, router, adminWorkspace, redirectingStaff]);

  useEffect(() => {
    if (!adminWorkspace || typeof window === "undefined") return;

    const handleTouchStart = (event: TouchEvent) => {
      if (!open && window.scrollY <= 0) {
        pullStartY.current = event.touches[0]?.clientY ?? null;
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (open || pullStartY.current === null || window.scrollY > 0) return;
      const currentY = event.touches[0]?.clientY ?? pullStartY.current;
      const distance = Math.max(0, Math.min(currentY - pullStartY.current, 96));
      pullDistanceRef.current = distance;
      setPullDistance(distance);
      if (distance > 4) event.preventDefault();
    };

    const handleTouchEnd = () => {
      const shouldReload = pullDistanceRef.current >= 64;
      pullStartY.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      if (shouldReload) window.location.reload();
    };

    document.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    document.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    document.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [adminWorkspace, open]);

  if (isLoading || !user || redirectingStaff) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <div className="flex flex-col items-center gap-3 text-white/58">
          <div className="size-10 rounded-full border-2 border-red-600/20 border-t-red-600 animate-spin" />
          <p className="text-sm">Preparing your workspace...</p>
        </div>
      </div>
    );
  }

  const initials = user.email?.charAt(0).toUpperCase() || "U";
  const allItems = adminWorkspace ? adminItems : navItems;
  const displayEmail = maskEmail(user.email);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch {
      setSignOutError("Could not complete secure sign out. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  };

  const startNavigation = () => {
    setIsNavigating(true);
    window.setTimeout(() => setIsNavigating(false), 1500);
  };

  return (
    <div className={cn("dark flex min-h-screen flex-col bg-[#050505] text-white", adminWorkspace && "trustpay-admin-console")}>
      {adminWorkspace && pullDistance > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center"
          role="status"
          aria-live="polite"
        >
          <span className="rounded-full border border-white/10 bg-black/85 px-3 py-1 text-xs text-white/70 shadow-lg">
            {pullDistance >= 64 ? "Release to refresh" : "Pull to refresh"}
          </span>
        </div>
      )}
      {isNavigating && (
        <div className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-white/10" role="status" aria-label="Loading section">
          <div className="h-full w-1/3 animate-[nav-progress_900ms_ease-in-out_infinite] bg-red-500" />
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/88 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="dark w-72 border-white/10 bg-[#050505] p-0 text-white"
              >
                <SheetTitle className="sr-only">Navigation menu</SheetTitle>
                <SheetDescription className="sr-only">
                  Choose where to go in TrustPay.
                </SheetDescription>
                <div className="border-b border-white/10 px-4 py-4">
                  <TrustPayLogo
                    imageClassName="size-10"
                    textClassName="text-base font-bold"
                  />
                  <p className="mt-1 text-xs text-white/48">
                    {adminWorkspace
                      ? "Operations and oversight"
                      : "Wallet workspace"}
                  </p>
                </div>
                <Sidebar
                  items={allItems}
                  pathname={pathname}
                  admin={adminWorkspace}
                  onNavigate={() => { setOpen(false); startNavigation(); }}
                />
              </SheetContent>
            </Sheet>
            <TrustPayLogo
              imageClassName="size-10"
              textClassName="text-xl font-bold"
            />
            {adminWorkspace && (
              <Badge
                variant="secondary"
                className="hidden border-red-500/20 bg-red-600/10 text-red-200 sm:inline-flex"
              >
                Admin workspace
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {adminWorkspace && <AdminNotificationBell />}
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-44 truncate text-sm sm:inline">
                    {displayEmail}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {!adminWorkspace && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link
                        href="/dashboard/profile"
                        className="cursor-pointer"
                      >
                        Profile
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        href="/dashboard/transactions"
                        className="cursor-pointer"
                      >
                        Transactions
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-destructive"
                  disabled={isSigningOut}
                  onClick={handleSignOut}
                >
                  <LogOut className="size-4" />
                  {isSigningOut ? "Signing out..." : "Sign Out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 self-start flex-col border-r border-white/10 bg-[#0b0b0b] md:flex">
          <Sidebar
            items={allItems}
            pathname={pathname}
            admin={adminWorkspace}
            onNavigate={startNavigation}
          />
          {adminWorkspace && (
            <div className="mt-auto border-t border-white/10 p-3">
              <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wide text-white/35">
                Account
              </p>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 px-3 text-sm text-white/60 hover:text-white"
                disabled={isSigningOut}
                onClick={handleSignOut}
              >
                <LogOut className="size-4" />
                {isSigningOut ? "Signing out..." : "Log out"}
              </Button>
            </div>
          )}
        </aside>
        <main className="trustpay-dashboard-motion min-w-0 flex-1 bg-[#0c1015] p-4 sm:p-6 lg:p-8">
          {signOutError && (
            <div
              role="alert"
              className="mx-auto mb-4 max-w-3xl rounded-lg border border-red-400/40 bg-red-950/40 px-4 py-3 text-sm text-red-200"
            >
              {signOutError}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
