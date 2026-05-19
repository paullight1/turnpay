"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-provider";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  ClipboardList,
  FileCheck2,
  Landmark,
  Menu,
  ShieldCheck,
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
  { label: "Profile", href: "/dashboard/profile", icon: UserRound },
];

const adminItems: NavItem[] = [
  { label: "Admin", href: "/admin", icon: ShieldCheck },
  { label: "KYC Review", href: "/admin/kyc", icon: FileCheck2 },
];

function Sidebar({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <nav className="flex flex-col gap-2 p-4">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              pathname === item.href
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            <Icon className="size-4" />
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

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-lg text-muted-foreground">
          Loading...
        </div>
      </div>
    );
  }

  const initials = user.email?.charAt(0).toUpperCase() || "U";
  const allItems = [...navItems, ...(user.role === "ADMIN" ? adminItems : [])];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
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
              <SheetContent side="left" className="w-64 p-0">
                <Sidebar items={allItems} pathname={pathname} />
              </SheetContent>
            </Sheet>
            <span className="text-xl font-bold text-primary">TrustPay</span>
            {user.role === "ADMIN" && <Badge variant="secondary">Admin</Badge>}
          </div>
          <div className="flex items-center gap-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden text-sm sm:inline">{user.email}</span>
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
                  className="cursor-pointer text-destructive"
                  onClick={signOut}
                >
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-64 border-r bg-muted/20 md:block">
          <Sidebar items={allItems} pathname={pathname} />
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
