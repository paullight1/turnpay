"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuthShell } from "@/components/auth/auth-shell";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { createRecoveryClient, isSupabaseConfigured } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";
import { useHydrated } from "@/lib/use-hydrated";

function ResetPasswordContent() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecoveryReady, setIsRecoveryReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const isHydrated = useHydrated();
  const router = useRouter();
  const searchParams = useSearchParams();
  const recoveryCode = searchParams.get("code");
  const recoveryClient = useMemo(
    () => (isSupabaseConfigured ? createRecoveryClient() : null),
    [],
  );

  useEffect(() => {
    let isMounted = true;

    const prepareRecoverySession = async () => {
      try {
        if (!recoveryClient) {
          throw new Error(
            "Password recovery is currently unavailable. Please contact support.",
          );
        }
        if (recoveryCode) {
          const { error } =
            await recoveryClient.auth.exchangeCodeForSession(recoveryCode);
          if (error) throw error;
        }

        const {
          data: { session },
          error,
        } = await recoveryClient.auth.getSession();

        if (error) throw error;
        if (!session) {
          throw new Error("Password reset link is invalid or expired");
        }

        if (isMounted) {
          setIsRecoveryReady(true);
          setRecoveryError(null);
        }
      } catch (error: unknown) {
        if (isMounted) {
          setIsRecoveryReady(false);
          setRecoveryError(
            getErrorMessage(error, "Password reset link is invalid or expired"),
          );
        }
      }
    };

    void prepareRecoverySession();

    return () => {
      isMounted = false;
    };
  }, [recoveryCode, recoveryClient]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!recoveryClient || !isRecoveryReady) {
      toast.error("Password reset link is invalid or expired");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    if (!/[A-Z]/.test(password) || !/\d/.test(password)) {
      toast.error("Password must include an uppercase letter and a number");
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await recoveryClient.auth.updateUser({ password });
      if (error) throw error;
      await recoveryClient.auth.signOut();
      toast.success("Password reset successfully");
      router.push("/");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to reset password"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title="Set a stronger password for your account."
      subtitle="Choose a password that protects wallet access, KYC details, transaction history, and account recovery."
    >
      <CardHeader className="text-center">
        <CardTitle className="text-3xl font-semibold">
          Set a new password
        </CardTitle>
        <CardDescription>
          Choose a strong password for your TrustPay account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {recoveryError ? (
          <div className="space-y-4 text-center">
            <p role="alert" className="text-sm text-destructive">{recoveryError}</p>
            <Button
              type="button"
              className="w-full"
              onClick={() => router.push("/forgot-password")}
            >
              Request a new link
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
            aria-busy={isLoading}
          >
            <fieldset disabled={!isHydrated || isLoading} className="contents">
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">New Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Min 8 chars, uppercase, number"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirm"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    aria-invalid={
                      confirmPassword.length > 0 && confirmPassword !== password
                    }
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showConfirmPassword
                        ? "Hide confirmation password"
                        : "Show confirmation password"
                    }
                    onClick={() =>
                      setShowConfirmPassword((current) => !current)
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                </div>
                <p
                  className={`text-xs ${confirmPassword && confirmPassword === password ? "text-emerald-300" : "text-muted-foreground"}`}
                >
                  {confirmPassword && confirmPassword === password
                    ? "Passwords match"
                    : "Use the same password twice"}
                </p>
              </div>
              <Button
                type="submit"
                disabled={isLoading || !isRecoveryReady}
                className="w-full"
              >
                {isLoading && (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                )}
                {isLoading ? "Resetting..." : "Reset Password"}
              </Button>
            </fieldset>
          </form>
        )}
      </CardContent>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background trustpay-ledger-bg">
          <div className="size-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
