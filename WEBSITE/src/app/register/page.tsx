"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronLeft,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth-provider";

type RegisterStep = {
  title: string;
  description: string;
  cardTitle: string;
  cardDescription: string;
  action: string;
  icon: React.ComponentType<{ className?: string }>;
};

const REGISTER_STEPS: RegisterStep[] = [
  {
    title: "Create a wallet profile.",
    description: "Start with the identity details tied to this TRUSTPAY account.",
    cardTitle: "Account owner",
    cardDescription: "Use the name, email, and phone number you want verified.",
    action: "Continue",
    icon: UserRound,
  },
  {
    title: "Secure account access.",
    description: "Set the password you will use when signing in on web.",
    cardTitle: "Sign-in password",
    cardDescription: "Use at least 8 characters with uppercase, lowercase, and a number.",
    action: "Set password",
    icon: ShieldCheck,
  },
  {
    title: "Protect money actions.",
    description: "Create the transaction PIN used for transfers, withdrawals, and swaps.",
    cardTitle: "Transaction PIN",
    cardDescription: "Use digits only. TRUSTPAY will never show this PIN after setup.",
    action: "Review setup",
    icon: KeyRound,
  },
  {
    title: "Review and finish.",
    description: "Confirm the owner details before creating the wallet.",
    cardTitle: "Confirm setup",
    cardDescription: "Your password and PIN stay hidden for security.",
    action: "Create account",
    icon: CheckCircle2,
  },
];

const emailRegex = /^[\w.-]+@[\w-]+\.\w+$/;
const phoneRegex = /^(\+?\d{10,15})$/;

export default function RegisterPage() {
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [transactionPin, setTransactionPin] = useState("");
  const [confirmTransactionPin, setConfirmTransactionPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { signUp } = useAuth();

  const currentStep = REGISTER_STEPS[step];
  const StepIcon = currentStep.icon;
  const isLastStep = step === REGISTER_STEPS.length - 1;
  const normalizedPhone = phone.replace(/\s+/g, "");
  const hasStrongPassword =
    password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
  const hasValidPin = /^\d{4,6}$/.test(transactionPin);
  const pinsMatch = hasValidPin && transactionPin === confirmTransactionPin;

  const validateCurrentStep = () => {
    if (step === 0) {
      if (fullName.trim().length < 2) {
        toast.error("Enter your full name");
        return false;
      }
      if (!emailRegex.test(email.trim())) {
        toast.error("Enter a valid email address");
        return false;
      }
      if (!phoneRegex.test(normalizedPhone)) {
        toast.error("Enter a valid phone number");
        return false;
      }
    }

    if (step === 1 && !hasStrongPassword) {
      toast.error("Password must include uppercase, lowercase, and a number");
      return false;
    }

    if (step >= 2) {
      if (!hasValidPin) {
        toast.error("Transaction PIN must be 4 to 6 digits");
        return false;
      }
      if (step === 3 && !pinsMatch) {
        toast.error("Transaction PINs do not match");
        return false;
      }
    }

    return true;
  };

  const goNext = () => {
    if (!validateCurrentStep()) return;
    setStep((current) => Math.min(current + 1, REGISTER_STEPS.length - 1));
  };

  const goBack = () => {
    if (isLoading) return;
    setStep((current) => Math.max(current - 1, 0));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isLastStep) {
      goNext();
      return;
    }

    if (!validateCurrentStep()) return;

    setIsLoading(true);

    try {
      await signUp(email.trim(), password, normalizedPhone, fullName, transactionPin);
      toast.success("Account created successfully");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Registration failed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title={currentStep.title}
      subtitle={currentStep.description}
      maxWidth="max-w-lg"
    >
      <CardHeader className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-10"
            onClick={goBack}
            disabled={step === 0 || isLoading}
            aria-label="Previous step"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
            Step {step + 1} of {REGISTER_STEPS.length}
          </div>
        </div>

        <div className="space-y-3 text-left">
          <div className="flex size-11 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <StepIcon className="size-5" />
          </div>
          <div>
            <CardTitle className="text-2xl font-semibold">{currentStep.cardTitle}</CardTitle>
            <CardDescription className="mt-2">{currentStep.cardDescription}</CardDescription>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2" aria-hidden="true">
          {REGISTER_STEPS.map((item, index) => (
            <span
              key={item.cardTitle}
              className={`h-1.5 rounded-full transition-colors ${
                index <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" aria-busy={isLoading}>
          {step === 0 ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  placeholder="Ada Mensah"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={120}
                  required
                />
              </div>
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  pattern="^(\+?\d{10,15})$"
                  placeholder="+2348012345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
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
                  aria-invalid={password.length > 0 && !hasStrongPassword}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
              <p className={`text-xs ${hasStrongPassword ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground"}`}>
                8+ chars, uppercase, lowercase, and number
              </p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="transactionPin">Transaction PIN</Label>
              <Input
                id="transactionPin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="4 to 6 digits"
                value={transactionPin}
                onChange={(e) => setTransactionPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                minLength={4}
                maxLength={6}
                autoComplete="new-password"
                aria-invalid={transactionPin.length > 0 && !hasValidPin}
              />
              <p className={`text-xs ${hasValidPin ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground"}`}>
                {hasValidPin ? "PIN length looks good" : "Use digits only"}
              </p>
            </div>
          ) : null}

          {step === 3 ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmTransactionPin">Confirm PIN</Label>
                <Input
                  id="confirmTransactionPin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Repeat PIN"
                  value={confirmTransactionPin}
                  onChange={(e) => setConfirmTransactionPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  minLength={4}
                  maxLength={6}
                  autoComplete="new-password"
                  aria-invalid={confirmTransactionPin.length > 0 && !pinsMatch}
                />
                <p className={`text-xs ${pinsMatch ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground"}`}>
                  {pinsMatch ? "PINs match" : "Repeat your transaction PIN"}
                </p>
              </div>

              <div className="rounded-md border bg-muted/60 p-4 text-sm">
                <p className="font-medium text-foreground">Account owner</p>
                <dl className="mt-3 grid gap-2 text-muted-foreground">
                  <div className="flex justify-between gap-4">
                    <dt>Name</dt>
                    <dd className="text-right font-medium text-foreground">{fullName.trim()}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Email</dt>
                    <dd className="text-right font-medium text-foreground">{email.trim()}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Phone</dt>
                    <dd className="text-right font-medium text-foreground">{normalizedPhone}</dd>
                  </div>
                </dl>
              </div>
            </>
          ) : null}

          {isLastStep ? (
            <Button type="submit" disabled={isLoading} className="mt-2 w-full">
              {isLoading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {isLoading ? "Creating account..." : currentStep.action}
            </Button>
          ) : (
            <Button type="button" disabled={isLoading} className="mt-2 w-full" onClick={goNext}>
              {currentStep.action}
            </Button>
          )}
        </form>

        {step === 0 ? (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        ) : null}
      </CardContent>
    </AuthShell>
  );
}
