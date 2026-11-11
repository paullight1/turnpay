"use client";

import { manualExchangeRequestHref } from "@/lib/admin-manual-exchange";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/lib/auth-provider";
import { hasAdminAccess } from "@/lib/admin-access";
import { getErrorMessage } from "@/lib/errors";
import { createManualExchangeIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import {
  adminNotificationsApi,
  type AdminNotification,
} from "@/services/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const notificationsQueryPrefix = "admin-notifications";
const unreadCountQueryPrefix = "admin-notification-unread-count";

type ReadErrors = Record<string, string | undefined>;

function normalizeNotifications(value: unknown): AdminNotification[] {
  if (!Array.isArray(value)) {
    throw new Error("The admin notification response was invalid.");
  }

  const byIdentity = new Map<string, AdminNotification>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;

    const item = candidate as Partial<AdminNotification>;
    if (
      typeof item.id !== "string" ||
      typeof item.eventKey !== "string" ||
      typeof item.audience !== "string" ||
      typeof item.orderId !== "string" ||
      typeof item.title !== "string" ||
      typeof item.createdAt !== "string" ||
      (item.readAt !== null && typeof item.readAt !== "string")
    ) {
      continue;
    }

    const notification: AdminNotification = {
      id: item.id,
      eventKey: item.eventKey,
      audience: item.audience,
      orderId: item.orderId,
      title: item.title,
      createdAt: item.createdAt,
      readAt: item.readAt ?? null,
    };
    const identity = `${notification.id}:${notification.eventKey}`;
    const existing = byIdentity.get(identity);

    // A retry can surface the same event more than once. Prefer a copy with
    // read state when the duplicate records disagree.
    if (!existing || (!existing.readAt && notification.readAt)) {
      byIdentity.set(identity, notification);
    }
  }

  return Array.from(byIdentity.values()).sort((left, right) => {
    const rightTime = Date.parse(right.createdAt);
    const leftTime = Date.parse(left.createdAt);
    return (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

function formatNotificationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  return date.toLocaleString("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function notificationDestination(notification: AdminNotification) {
  const eventKey = notification.eventKey.toLowerCase();

  if (eventKey.startsWith("manual-exchange:")) {
    return {
      href: manualExchangeRequestHref(notification.orderId),
      label: "Exchange request",
    };
  }

  if (eventKey.startsWith("vtu:")) {
    return { href: "/admin/vtu", label: "VTU oversight" };
  }

  if (
    eventKey.startsWith("exchange:") ||
    eventKey.startsWith("exchange-") ||
    eventKey.startsWith("exchange-funded:")
  ) {
    return { href: "/admin/exchange/provider", label: "Provider exchange" };
  }

  return { href: "/admin", label: "Admin overview" };
}

export function adminNotificationsQueryOptions(adminId: string | null) {
  return queryOptions({
    queryKey: [notificationsQueryPrefix, adminId],
    queryFn: async () => {
      const response = await adminNotificationsApi.list();
      return normalizeNotifications(response.data);
    },
    staleTime: 10_000,
  });
}

export function AdminNotificationBell() {
  const { user, profile, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isForeground, setIsForeground] = useState(true);
  const [readErrors, setReadErrors] = useState<ReadErrors>({});
  const readAttemptKeysRef = useRef<Map<string, string>>(new Map());
  const adminId = profile?.id ?? user?.id ?? null;
  const allowed = hasAdminAccess(user) || hasAdminAccess(profile);
  const listOptions = adminNotificationsQueryOptions(adminId);
  const { queryKey } = listOptions;
  const unreadCountQueryKey = useMemo(
    () => [unreadCountQueryPrefix, adminId] as const,
    [adminId],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    const syncVisibility = () => {
      setIsForeground(document.visibilityState === "visible");
    };

    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () =>
      document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  const notificationsQuery = useQuery({
    ...listOptions,
    enabled: !authLoading && allowed && Boolean(adminId),
    refetchInterval: isForeground ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const unreadCountQuery = useQuery({
    queryKey: unreadCountQueryKey,
    queryFn: async () => {
      const response = await adminNotificationsApi.unreadCount();
      const unreadCount = response.data.unreadCount;
      if (!Number.isInteger(unreadCount) || unreadCount < 0) {
        throw new Error("The admin unread notification count was invalid.");
      }
      return unreadCount;
    },
    enabled: !authLoading && allowed && Boolean(adminId),
    staleTime: 10_000,
    refetchInterval: isForeground ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const getReadAttemptKey = useCallback(
    (notificationId: string) => {
      if (!adminId) return createManualExchangeIdempotencyKey();

      const identity = `${adminId}:${notificationId}`;
      const cached = readAttemptKeysRef.current.get(identity);
      if (cached) return cached;

      const storageKey = `trustpay:admin-notification-read:${identity}`;
      if (typeof window !== "undefined") {
        try {
          const persisted = window.sessionStorage.getItem(storageKey);
          if (persisted) {
            readAttemptKeysRef.current.set(identity, persisted);
            return persisted;
          }
        } catch {
          // The in-memory key still protects a retry when storage is blocked.
        }
      }

      const nextKey = createManualExchangeIdempotencyKey();
      readAttemptKeysRef.current.set(identity, nextKey);
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(storageKey, nextKey);
        } catch {
          // The key remains available in memory for this page session.
        }
      }
      return nextKey;
    },
    [adminId],
  );

  const clearReadAttemptKey = useCallback(
    (notificationId: string) => {
      if (!adminId) return;

      const identity = `${adminId}:${notificationId}`;
      readAttemptKeysRef.current.delete(identity);
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.removeItem(
            `trustpay:admin-notification-read:${identity}`,
          );
        } catch {
          // There is no sensitive data to recover if storage is unavailable.
        }
      }
    },
    [adminId],
  );

  const readMutation = useMutation({
    mutationFn: async ({
      notificationId,
      idempotencyKey,
    }: {
      notificationId: string;
      idempotencyKey: string;
    }) => {
      const response = await adminNotificationsApi.markRead(
        notificationId,
        idempotencyKey,
      );
      return {
        notificationId,
        readAt: response.data.readAt ?? new Date().toISOString(),
      };
    },
    onSuccess: ({ notificationId, readAt }) => {
      clearReadAttemptKey(notificationId);
      setReadErrors((current) => {
        if (!(notificationId in current)) return current;
        const next = { ...current };
        delete next[notificationId];
        return next;
      });
      queryClient.setQueryData<AdminNotification[]>(queryKey, (current) =>
        (current ?? []).map((notification) =>
          notification.id === notificationId
            ? { ...notification, readAt }
            : notification,
        ),
      );
      queryClient.setQueryData<number>(unreadCountQueryKey, (current) =>
        Math.max(0, (current ?? 0) - 1),
      );
      void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
    },
    onError: (error: unknown, variables) => {
      setReadErrors((current) => ({
        ...current,
        [variables.notificationId]: getErrorMessage(
          error,
          "Could not mark this notification as read.",
        ),
      }));
    },
  });

  const notifications = notificationsQuery.data ?? [];
  // The list endpoint is intentionally bounded. Always source the badge from
  // the dedicated count endpoint so older unread rows remain represented.
  const unreadCount = unreadCountQuery.data;
  const hasKnownUnreadCount = typeof unreadCount === "number";
  const unreadCountUnavailable = unreadCountQuery.isError;
  const isNotificationLoading =
    notificationsQuery.isPending || unreadCountQuery.isPending;
  const isNotificationFetching =
    notificationsQuery.isFetching || unreadCountQuery.isFetching;

  const retryNotifications = () => {
    void Promise.all([
      notificationsQuery.refetch(),
      unreadCountQuery.refetch(),
    ]);
  };

  const handleMarkRead = (notificationId: string) => {
    // A read may have committed even when its response was lost. Trust the
    // next server refresh rather than sending another request for a read row.
    if (notifications.some((item) => item.id === notificationId && item.readAt)) return;
    if (readMutation.isPending) return;
    setReadErrors((current) => ({ ...current, [notificationId]: undefined }));
    readMutation.mutate({
      notificationId,
      idempotencyKey: getReadAttemptKey(notificationId),
    });
  };

  if (!authLoading && !allowed) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            unreadCountUnavailable && !hasKnownUnreadCount
              ? "Admin notifications, unread count unavailable"
              : `Admin notifications${unreadCount ? `, ${unreadCount} unread` : ""}`
          }
          data-testid="admin-notifications-trigger"
          className="relative size-11 text-foreground hover:text-foreground"
        >
          <Bell aria-hidden="true" className="size-6" strokeWidth={2.5} />
          {hasKnownUnreadCount && unreadCount > 0 && (
            <span
              className="absolute right-0 top-0 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-5 text-white shadow-sm"
              data-testid="admin-notification-unread-count"
              aria-label={`${unreadCount} unread notifications`}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-96 max-w-[calc(100vw-2rem)] border-border p-0 dark:bg-[#11161d]"
        data-testid="admin-notification-inbox"
      >
        <div className="flex items-start justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Admin inbox</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isNotificationLoading
                ? "Checking for updates…"
                : unreadCountUnavailable
                  ? hasKnownUnreadCount
                    ? unreadCount > 0
                      ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"} · refresh failed`
                      : "Unread count refresh failed"
                    : "Unread count unavailable"
                  : unreadCount
                    ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`
                    : "You’re up to date"}
            </p>
          </div>
          {isNotificationFetching && !isNotificationLoading && (
            <LoaderCircle
              className="mt-0.5 size-4 animate-spin text-muted-foreground"
              aria-label="Refreshing notifications"
            />
          )}
        </div>
        <DropdownMenuSeparator className="bg-border" />

        {notificationsQuery.isPending ? (
          <div className="space-y-2 p-3" aria-label="Loading notifications">
            {["one", "two", "three"].map((key) => (
              <div
                key={key}
                className="h-16 animate-pulse rounded-lg bg-muted"
              />
            ))}
          </div>
        ) : notificationsQuery.isError ? (
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            <CircleAlert className="size-6 text-amber-700 dark:text-amber-300" />
            <div>
              <p className="text-sm font-medium">Notifications unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {getErrorMessage(
                  notificationsQuery.error,
                  "Try again to refresh the admin inbox.",
                )}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground"
              onClick={retryNotifications}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-9 text-center">
            <Bell className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No admin notifications</p>
            <p className="text-xs text-muted-foreground">
              New exchange and service updates will appear here.
            </p>
          </div>
        ) : (
          <div className="max-h-[min(32rem,calc(100vh-10rem))] space-y-2 overflow-y-auto p-3">
            {unreadCountQuery.isError && (
              <div
                className="flex items-center justify-between gap-3 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
                role="alert"
              >
                <span>Unread count unavailable; refresh to try again.</span>
                <button
                  type="button"
                  className="shrink-0 font-semibold underline underline-offset-2"
                  onClick={retryNotifications}
                >
                  Retry
                </button>
              </div>
            )}
            {notifications.map((notification) => {
              const destination = notificationDestination(notification);
              const readError = notification.readAt
                ? undefined
                : readErrors[notification.id];
              const isMarkingRead =
                readMutation.isPending &&
                readMutation.variables?.notificationId === notification.id;

              return (
                <div
                  key={`${notification.id}:${notification.eventKey}`}
                  className={cn(
                    "rounded-lg border border-border bg-muted/50 p-3 transition-colors",
                    !notification.readAt && "border-red-400/25 bg-red-500/[0.06]",
                  )}
                  data-testid={`admin-notification-${notification.id}`}
                >
                  <div className="flex gap-3">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/40",
                        !notification.readAt && "bg-red-400",
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={destination.href}
                        onClick={() => setOpen(false)}
                        className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      >
                        <span className="block text-sm font-medium leading-5 text-foreground">
                          {notification.title}
                        </span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {destination.label} · {formatNotificationDate(notification.createdAt)}
                        </span>
                      </Link>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {notification.readAt ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-800 dark:text-emerald-300">
                            <Check className="size-3" /> Read
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="rounded px-1.5 py-1 text-[11px] font-medium text-red-800 dark:text-red-200 underline-offset-2 hover:bg-red-400/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isMarkingRead}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleMarkRead(notification.id);
                            }}
                            data-testid={`admin-notification-mark-read-${notification.id}`}
                          >
                            {isMarkingRead ? "Saving…" : "Mark read"}
                          </button>
                        )}
                        <Badge
                          variant="outline"
                          className="border-border px-1.5 text-[10px] text-muted-foreground"
                        >
                          {notification.audience}
                        </Badge>
                      </div>
                      {readError && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded border border-red-400/20 bg-red-500/10 px-2 py-1.5">
                          <p
                            className="min-w-0 text-[11px] text-red-800 dark:text-red-200"
                            role="alert"
                          >
                            {readError}
                          </p>
                          <button
                            type="button"
                            className="shrink-0 text-[11px] font-semibold text-red-800 underline underline-offset-2 dark:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                            onClick={() => handleMarkRead(notification.id)}
                          >
                            Retry
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
