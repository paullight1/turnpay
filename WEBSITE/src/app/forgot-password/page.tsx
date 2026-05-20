"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { ShieldCheck } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { resetPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await resetPassword(email);
      setSent(true);
      toast.success("Password reset link sent to your email");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to send reset link"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#050605] px-4 py-10 text-white">
      <div className="absolute -left-28 -top-64 -z-10 h-[30rem] w-[calc(100%+14rem)] rounded-[0_0_100%_100%] bg-[radial-gradient(circle_at_45%_55%,#ffd36b_0%,#ff7a18_34%,#dc2f02_58%,rgba(5,6,5,0)_74%)] opacity-85 blur-[2px]" />
      <Card className="w-full max-w-md border-white/10 bg-card/92 shadow-2xl shadow-black/40">
        <CardHeader className="text-center">
          <div className="mx-auto grid size-11 place-items-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </div>
          <CardTitle className="text-3xl font-semibold">Reset access</CardTitle>
          <CardDescription>
            {sent ? "Check your email for the reset link." : "Enter your email to reset your password."}
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
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? "Sending..." : "Send Reset Link"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Remember your password?{" "}
                <Link href="/login" className="text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
