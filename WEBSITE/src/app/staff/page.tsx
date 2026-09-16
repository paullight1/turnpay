"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import {
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-provider";
import { hasAdminAccess } from "@/lib/admin-access";
import { useHydrated } from "@/lib/use-hydrated";
import { getErrorMessage } from "@/lib/errors";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { authApi } from "@/services/api";

export default function StaffAccessPage() {
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const attemptKey = useRef<string | null>(null);
  const hydrated = useHydrated();
  const { signIn, signOut, profile, isLoading } = useAuth();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const address = email.trim().toLowerCase();
    if (creating && !/^[^@\s]+@trustpayhq\.com$/.test(address)) {
      setError(
        "Use your @trustpayhq.com work email to create a staff account.",
      );
      return;
    }
    if (creating && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/.test(password)) {
      setError("Use 8–72 characters with uppercase, lowercase and a number.");
      return;
    }
    setBusy(true);
    try {
      if (creating) {
        attemptKey.current ??= createMoneyAttemptIdempotencyKey("mutation");
        await authApi.registerStaff(
          { email: address, password, fullName: fullName.trim() || undefined },
          attemptKey.current,
        );
        setPassword("");
        setSent(true);
      } else {
        await signIn(address, password, "/admin");
      }
    } catch (failure) {
      setError(
        getErrorMessage(
          failure,
          "Could not complete staff sign-in. Please try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    setLogoutError(null);
    try {
      await signOut();
    } catch {
      setLogoutError("Could not complete secure sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function changeMode() {
    setCreating(!creating);
    setError(null);
    setSent(false);
    setResendMessage(null);
    setPassword("");
    setShowPassword(false);
    attemptKey.current = null;
  }

  async function resendConfirmation() {
    if (busy) return;
    setBusy(true);
    setResendMessage(null);
    try {
      await authApi.resendConfirmation(email.trim().toLowerCase());
      setResendMessage(
        "If the account is eligible, a new verification email is on its way. Check your spam or promotions folder too.",
      );
    } catch {
      setResendMessage(
        "We could not resend the email right now. Please try again shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="" subtitle="" showHero={false} showHelp={false}>
      <CardHeader className="space-y-3">
        <ShieldCheck aria-hidden="true" className="size-7 text-red-400" />
        <CardTitle className="text-2xl">
          {sent
            ? "Check your work email"
            : creating
              ? "Create a staff account"
              : "Staff access"}
        </CardTitle>
        <CardDescription className="text-white/65">
          {sent
            ? "Verify your email using the message from TrustPay, then return here to sign in."
            : creating
              ? "Use your TrustPay work email. No phone number or wallet PIN is needed."
              : "For assigned admins. Staff account creation is subject to approval."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && (
          <p role="status" className="text-sm text-white/65">
            Checking your session…
          </p>
        )}
        {profile && !hasAdminAccess(profile) && (
          <div
            role="status"
            className="rounded-lg border border-white/15 p-4 text-sm"
          >
            This signed-in account does not have admin access. Verify your work
            email, or sign out to use your staff account. An explicit ADMIN role
            is required to open the admin panel.
            {logoutError && (
              <p role="alert" className="mt-3 text-red-200">
                {logoutError}
              </p>
            )}
            <Button
              variant="link"
              className="px-0 text-red-400"
              disabled={busy}
              onClick={handleSignOut}
            >
              {busy ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        )}
        {profile && hasAdminAccess(profile) && (
          <div className="space-y-3">
            <p className="text-sm text-white/75">
              Signed in as {profile.email}
            </p>
            {logoutError && (
              <p role="alert" className="text-sm text-red-200">
                {logoutError}
              </p>
            )}
            <Button asChild className="w-full">
              <Link href="/admin">Open admin panel</Link>
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={handleSignOut}
            >
              {busy ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        )}
        {!profile &&
          !isLoading &&
          (sent ? (
            <div className="space-y-4">
              <p role="status" className="text-sm text-white/75">
                A verification link—not a numeric OTP—was requested for{" "}
                {email.trim()}. Open the message from TrustPay to verify your
                work email, then return here to sign in.
              </p>
              {resendMessage && (
                <p role="status" className="text-sm text-white/75">
                  {resendMessage}
                </p>
              )}
              <Button
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={resendConfirmation}
              >
                {busy ? "Resending…" : "Resend verification email"}
              </Button>
              <Button
                className="w-full"
                onClick={() => {
                  setCreating(false);
                  setSent(false);
                }}
              >
                Back to staff sign-in
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <fieldset disabled={busy || !hydrated} className="space-y-4">
                {creating && (
                  <div className="space-y-2">
                    <Label htmlFor="staff-name">Name (optional)</Label>
                    <Input
                      id="staff-name"
                      autoComplete="name"
                      maxLength={120}
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        attemptKey.current = null;
                      }}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="staff-email">
                    {creating ? "Work email" : "Email"}
                  </Label>
                  <Input
                    id="staff-email"
                    type="email"
                    autoComplete="username"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      attemptKey.current = null;
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="staff-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        creating ? "new-password" : "current-password"
                      }
                      required
                      maxLength={72}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        attemptKey.current = null;
                      }}
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
                {creating && (
                  <p className="text-xs text-white/65">
                    8–72 characters with uppercase, lowercase and a number.
                    Verify your work email before accessing the admin panel.
                  </p>
                )}
                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-400/40 bg-red-950/40 p-3 text-sm text-red-200"
                  >
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full bg-red-600 text-white hover:bg-red-700"
                >
                  {busy && (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                  )}
                  {busy
                    ? "Please wait…"
                    : creating
                      ? "Create staff account"
                      : "Sign in to admin"}
                </Button>
              </fieldset>
            </form>
          ))}
        {!profile && !isLoading && !sent && (
          <button
            type="button"
            disabled={busy}
            onClick={changeMode}
            className="text-sm font-medium text-red-400 hover:text-red-300"
          >
            {creating
              ? "Already have an account? Sign in"
              : "New staff member? Create account"}
          </button>
        )}
        <div className="flex justify-end gap-4 text-sm text-white/65">
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
      </CardContent>
    </AuthShell>
  );
}
