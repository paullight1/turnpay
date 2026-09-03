"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-provider";
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
import Link from "next/link";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { Loader2 } from "lucide-react";
import { useHydrated } from "@/lib/use-hydrated";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const isHydrated = useHydrated();
  const { resetPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await resetPassword(email.trim());
      setSent(true);
      toast.success("Password reset link sent to your email");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to send reset link"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title="Recover access without weakening security."
      subtitle="Reset your password through a protected email link, then return to your wallet with the same transaction controls."
    >
      <CardHeader className="text-center">
        <CardTitle className="text-3xl font-semibold">Reset access</CardTitle>
        <CardDescription>
          {sent
            ? "Check your email for the reset link."
            : "Enter your email to reset your password."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="text-center space-y-4">
            <p className="text-muted-foreground">
              We&apos;ve sent a password reset link to <strong>{email}</strong>
            </p>
            <Link href="/login">
              <Button className="w-full">Back to Login</Button>
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
            aria-busy={isLoading}
          >
            <fieldset disabled={!isHydrated || isLoading} className="contents">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                {isLoading && (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                )}
                {isLoading ? "Sending..." : "Send Reset Link"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Remember your password?{" "}
                <Link href="/login" className="text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </fieldset>
          </form>
        )}
      </CardContent>
    </AuthShell>
  );
}
