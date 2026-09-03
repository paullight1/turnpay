"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
} from "lucide-react";
import { toast } from "sonner";

import { TrustPayLogo } from "@/components/brand/trustpay-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth-provider";
import { useHydrated } from "@/lib/use-hydrated";

type AuthDebugState = {
  stage: string;
  error?: string;
  email?: string;
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [debugState, setDebugState] = useState<AuthDebugState | null>(null);
  const [authProviderDebug, setAuthProviderDebug] =
    useState<AuthDebugState | null>(null);
  const isHydrated = useHydrated();
  const { signIn } = useAuth();

  const setLoginDebug = (stage: string, extra?: Record<string, unknown>) => {
    const nextState = {
      stage,
      ...extra,
    };

    setDebugState(nextState);

    if (process.env.NODE_ENV === "production") {
      return;
    }

    (
      window as Window & { __TRUSTPAY_LOGIN_DEBUG__?: Record<string, unknown> }
    ).__TRUSTPAY_LOGIN_DEBUG__ = nextState;
  };

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return undefined;
    }

    const syncAuthDebug = () => {
      const value = (
        window as Window & {
          __TRUSTPAY_AUTH_DEBUG__?: AuthDebugState;
        }
      ).__TRUSTPAY_AUTH_DEBUG__;
      setAuthProviderDebug(value ?? null);
    };

    syncAuthDebug();
    const interval = window.setInterval(syncAuthDebug, 250);

    const target = window as Window & {
      __TRUSTPAY_FORCE_LOGIN__?: (
        nextEmail: string,
        nextPassword: string,
      ) => Promise<void>;
    };

    target.__TRUSTPAY_FORCE_LOGIN__ = async (nextEmail, nextPassword) => {
      setEmail(nextEmail);
      setPassword(nextPassword);
      setIsLoading(true);
      setLoginDebug("global-force-login-start", { email: nextEmail });

      try {
        await signIn(nextEmail, nextPassword);
        setLoginDebug("global-force-login-success", { email: nextEmail });
      } catch (error: unknown) {
        setLoginDebug("global-force-login-error", {
          email: nextEmail,
          error: getErrorMessage(error, "Login failed"),
        });
        throw error;
      } finally {
        setIsLoading(false);
      }
    };

    return () => {
      window.clearInterval(interval);
      delete target.__TRUSTPAY_FORCE_LOGIN__;
    };
  }, [signIn]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setLoginDebug("submit-start", { email });

    try {
      await signIn(email.trim(), password);
      setLoginDebug("submit-success", { email });
      toast.success("Welcome back!");
    } catch (error: unknown) {
      setLoginDebug("submit-error", {
        email,
        error: getErrorMessage(error, "Login failed"),
      });
      toast.error(getErrorMessage(error, "Login failed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#050505] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(220,38,38,0.22),transparent_32%)]" />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col justify-center gap-10 lg:grid lg:grid-cols-[1fr_440px] lg:items-center">
        <section className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
          <Link href="/" className="inline-flex items-center gap-3">
            <TrustPayLogo
              imageClassName="size-12"
              textClassName="text-2xl font-black"
            />
          </Link>

          <p className="mt-8 max-w-xl text-sm leading-6 text-white/58 md:text-base">
            Sign in to manage your wallet, exchange money, pay bills, and review
            receipts.
          </p>
        </section>

        <Card className="mx-auto w-full max-w-md rounded-xl border-white/10 bg-[#111111] text-white shadow-2xl shadow-black/40">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-3xl font-black">Sign in</CardTitle>
            <p className="text-sm leading-6 text-white/52">
              Use your TrustPay email and password.
            </p>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-5"
              aria-busy={isLoading}
            >
              <fieldset
                disabled={!isHydrated || isLoading}
                className="contents"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email" className="text-white/80">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/36"
                    />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      className="h-12 border-white/10 bg-black/50 pl-10 text-white placeholder:text-white/30"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="password" className="text-white/80">
                      Password
                    </Label>
                    <Link
                      href="/forgot-password"
                      className="text-xs font-semibold text-red-400 hover:text-red-300"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <LockKeyhole
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/36"
                    />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      className="h-12 border-white/10 bg-black/50 pl-10 pr-11 text-white placeholder:text-white/30"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 hover:bg-white/10 hover:text-white"
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

                <Button
                  type="submit"
                  className="h-12 rounded-full bg-red-600 text-white hover:bg-red-700"
                >
                  {isLoading ? (
                    <>
                      <Loader2
                        aria-hidden="true"
                        className="size-4 animate-spin"
                      />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight data-icon="inline-end" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </fieldset>
            </form>

            <p className="mt-6 text-center text-sm text-white/52">
              New to TrustPay?{" "}
              <Link
                href="/register"
                className="font-semibold text-red-400 hover:text-red-300"
              >
                Create account
              </Link>
            </p>
            {process.env.NODE_ENV !== "production" ? (
              <div className="mt-6 space-y-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-[11px] text-white/45">
                Debug: {debugState?.stage ?? "idle"}
                {debugState?.error ? ` | ${String(debugState.error)}` : ""}
                <p>
                  Auth: {authProviderDebug?.stage ?? "idle"}
                  {authProviderDebug?.error
                    ? ` | ${String(authProviderDebug.error)}`
                    : ""}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
