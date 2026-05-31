"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-provider";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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
  ShieldCheck,
  LogOut,
  Smartphone,
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
  { label: "Withdraw", href: "/dashboard/withdraw", icon: Landmark },
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
  { label: "Admin", href: "/admin", icon: ShieldCheck },
  { label: "VTU Ops", href: "/admin/vtu", icon: Smartphone },
  { label: "Support Queue", href: "/admin/support", icon: LifeBuoy },
  { label: "KYC Review", href: "/admin/kyc", icon: FileCheck2 },
];

function Sidebar({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav
      className="flex flex-col gap-1.5 p-3"
      aria-label="Dashboard navigation"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group/nav relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-[background-color,color,transform,box-shadow]",
              active
                ? "bg-primary text-primary-foreground shadow-sm shadow-orange-950/30"
                : "text-muted-foreground hover:translate-x-0.5 hover:bg-muted hover:text-foreground",
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

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background trustpay-ledger-bg">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <p className="text-sm">Preparing your workspace...</p>
        </div>
      </div>
    );
  }

  const initials = user.email?.charAt(0).toUpperCase() || "U";
  const allItems = [...navItems, ...(user.role === "ADMIN" ? adminItems : [])];
  const displayEmail = maskEmail(user.email);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/86 backdrop-blur-xl">
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
              <SheetContent side="left" className="w-72 p-0">
                <div className="border-b border-border px-4 py-4">
                  <p className="text-sm font-semibold">TrustPay</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Wallet operations
                  </p>
                </div>
                <Sidebar
                  items={allItems}
                  pathname={pathname}
                  onNavigate={() => setOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <span className="text-xl font-bold text-foreground">TrustPay</span>
            {user.role === "ADMIN" && (
              <Badge variant="secondary" className="border-border">
                Admin
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
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
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/profile" className="cursor-pointer">
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
        <aside className="hidden w-64 border-r border-border bg-card/40 md:block">
          <Sidebar items={allItems} pathname={pathname} />
        </aside>
        <main className="trustpay-dashboard-motion flex-1 bg-[linear-gradient(135deg,rgba(255,107,10,0.08),rgba(16,185,129,0.045),transparent_42%),var(--background)] p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
