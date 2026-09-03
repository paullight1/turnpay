"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LockKeyhole, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-provider";
import { getMoneyActionGate } from "@/lib/account-status";
import { getErrorMessage } from "@/lib/errors";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import {
  countTransferNoteCodePoints,
  type EligibleRecipientPreview,
  formatTransferMoney,
  parseRecipient,
  transferAttemptFingerprint,
  transferFinancialRows,
  type InternalTransferReceipt,
  type TransferCurrency,
  type TransferValidationErrors,
  type ValidatedInternalTransfer,
  validateInternalTransfer,
} from "@/lib/transfer-contract";
import { authApi, transferApi, walletApi } from "@/services/api";
import type { Wallet } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Attempt = {
  fingerprint: string;
  key: string;
  transfer: ValidatedInternalTransfer;
};

function DetailRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-200 py-3 last:border-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-semibold tabular-nums text-slate-950" data-testid={testId}>{value}</dd>
    </div>
  );
}

function PinSetup({ onReady }: { onReady: () => Promise<void> }) {
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current) return;
    if (!/^\d{4,6}$/.test(pin)) {
      setError("Use a 4 to 6 digit transaction PIN.");
      return;
    }
    if (pin !== confirmation) {
      setError("Transaction PINs do not match.");
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const key = createMoneyAttemptIdempotencyKey("transaction-pin-setup");
      await authApi.setTransactionPin(pin, key);
      setPin("");
      setConfirmation("");
      toast.success("Your transaction PIN is ready");
      await onReady();
    } catch (cause) {
      setError(getErrorMessage(cause, "Unable to create your transaction PIN."));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-amber-200 bg-amber-50/80 text-slate-950">
      <CardHeader>
        <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-amber-100 text-amber-800">
          <LockKeyhole aria-hidden="true" className="size-5" />
        </div>
        <h2 className="text-xl font-semibold leading-none tracking-tight">Create transaction PIN</h2>
        <CardDescription className="text-slate-600">Create a private 4 to 6 digit PIN before sending money. Never share it with anyone.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="new-transfer-pin">New transaction PIN</Label>
          <Input id="new-transfer-pin" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm-transfer-pin">Confirm transaction PIN</Label>
          <Input id="confirm-transfer-pin" type="password" inputMode="numeric" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        </div>
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        <Button onClick={() => void submit()} disabled={submitting} className="min-h-12 bg-slate-950 text-white hover:bg-slate-800">
          {submitting ? "Creating PIN…" : "Create PIN"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function InternalTransferForm() {
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const moneyGate = getMoneyActionGate(profile);
  const [recipient, setRecipient] = useState("");
  const [preview, setPreview] = useState<EligibleRecipientPreview | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<TransferCurrency>("NGN");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [errors, setErrors] = useState<TransferValidationErrors>({});
  const [pageError, setPageError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<InternalTransferReceipt | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const inFlight = useRef(false);

  const pinStatus = useQuery({
    queryKey: ["transaction-pin-status", user?.id],
    queryFn: async () => (await authApi.getTransactionPinStatus()).data,
    enabled: Boolean(user),
  });
  const wallets = useQuery({
    queryKey: ["wallets", user?.id],
    queryFn: async () => (await walletApi.getBalances()).data as Wallet[],
    enabled: Boolean(user),
  });

  const resetAttempt = () => {
    setAttempt(null);
    setReceipt(null);
    setPageError(null);
    setReviewOpen(false);
  };

  const updateRecipient = (value: string) => {
    setRecipient(value);
    setPreview(null);
    setErrors((current) => ({ ...current, recipient: undefined }));
    resetAttempt();
  };

  const resolveRecipient = async () => {
    const parsed = parseRecipient(recipient);
    if (!parsed) {
      setErrors((current) => ({ ...current, recipient: "Enter a valid email address or international phone number." }));
      return;
    }
    setResolving(true);
    setPageError(null);
    try {
      const response = await transferApi.previewRecipient(parsed);
      if (!response.data.found) {
        setPreview(null);
        setPageError("Recipient cannot be found or used for this transfer.");
        return;
      }
      setPreview(response.data);
      setErrors((current) => ({ ...current, recipient: undefined }));
    } catch (cause) {
      setPreview(null);
      setPageError(getErrorMessage(cause, "Recipient could not be verified."));
    } finally {
      setResolving(false);
    }
  };

  const validatedTransfer = () => {
    const result = validateInternalTransfer({ recipient, amount, currency, note });
    setErrors(result.errors);
    if (!preview && !result.errors.recipient) {
      setErrors((current) => ({ ...current, recipient: "Verify the recipient before continuing." }));
      return null;
    }
    return result.value ?? null;
  };

  const openReview = () => {
    setPageError(null);
    if (moneyGate) {
      setPageError(moneyGate.message);
      return;
    }
    const transfer = validatedTransfer();
    if (!transfer) return;
    if (!/^\d{4,6}$/.test(pin)) {
      setPageError("Enter your 4 to 6 digit transaction PIN.");
      return;
    }
    const fingerprint = transferAttemptFingerprint(transfer);
    setAttempt((current) => current?.fingerprint === fingerprint ? current : {
      fingerprint,
      key: createMoneyAttemptIdempotencyKey("internal-transfer"),
      transfer,
    });
    setReviewOpen(true);
  };

  const submitAttempt = async (candidate = attempt) => {
    if (!candidate || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setPageError(null);
    try {
      const response = await transferApi.sendInternal({
        ...candidate.transfer.recipient,
        amount: candidate.transfer.amount,
        currency: candidate.transfer.currency,
        ...(candidate.transfer.note ? { note: candidate.transfer.note } : {}),
        transactionPin: pin,
      }, candidate.key);
      setReceipt(response.data);
      setReviewOpen(false);
      setAttempt(null);
      setPin("");
      await queryClient.invalidateQueries({ queryKey: ["wallets", user?.id] });
    } catch (cause) {
      setReviewOpen(false);
      setPageError(getErrorMessage(cause, "Transfer could not be completed."));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const startAnother = () => {
    setRecipient("");
    setPreview(null);
    setAmount("");
    setNote("");
    setPin("");
    setErrors({});
    resetAttempt();
  };

  if (pinStatus.isLoading) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Checking transaction security…</CardContent></Card>;
  }
  if (pinStatus.isError) {
    return (
      <Card className="border-red-200 bg-red-50 text-slate-950"><CardContent className="grid gap-3 py-6">
        <p role="alert">Transaction security status is unavailable. Sending is disabled.</p>
        <Button variant="outline" onClick={() => void pinStatus.refetch()}><RefreshCw aria-hidden="true" className="size-4" />Retry security check</Button>
      </CardContent></Card>
    );
  }
  if (!pinStatus.data?.configured) {
    return <PinSetup onReady={async () => { await pinStatus.refetch(); }} />;
  }

  const activeTransfer = attempt?.transfer;
  const reviewRows = activeTransfer ? transferFinancialRows(activeTransfer.amount, activeTransfer.currency) : [];
  const receiptRows = receipt ? transferFinancialRows(receipt.amount, receipt.currency) : [];
  const selectedWallet = wallets.data?.find((wallet) => wallet.currency === currency);

  if (receipt) {
    return (
      <Card className="overflow-hidden border-emerald-200 bg-white text-slate-950 shadow-lg shadow-emerald-950/5">
        <div className="h-1.5 bg-emerald-500" />
        <CardHeader className="items-center text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 aria-hidden="true" className="size-7" /></div>
          <h2 className="text-2xl font-semibold leading-none tracking-tight">Transfer complete</h2>
          <CardDescription>{receipt.recipient.maskedIdentifier} has been credited.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <dl className="rounded-xl border border-slate-200 px-4">
            <DetailRow label="Reference" value={receipt.reference} />
            <DetailRow label={receiptRows[0].label} value={receiptRows[0].value} />
            <DetailRow label={receiptRows[1].label} value={receiptRows[1].value} testId="receipt-fee" />
            <DetailRow label={receiptRows[2].label} value={receiptRows[2].value} testId="receipt-total" />
            <DetailRow label="Balance after" value={formatTransferMoney(receipt.senderBalanceAfter, receipt.currency)} />
          </dl>
          <Button onClick={startAnother} className="min-h-12">Send another transfer</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
        <CardHeader>
          <CardTitle>Transfer details</CardTitle>
          <CardDescription className="text-slate-600">Send from your TrustPay wallet to another verified TrustPay user.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {moneyGate && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">{moneyGate.title}</p><p className="mt-1">{moneyGate.message}</p></div>}
          {pinStatus.data.locked && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">Your transaction PIN is temporarily locked. Try again later.</div>}
          <div className="grid gap-2">
            <Label htmlFor="transfer-recipient">Recipient email or phone</Label>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input id="transfer-recipient" autoComplete="off" value={recipient} onChange={(event) => updateRecipient(event.target.value)} aria-describedby={errors.recipient ? "recipient-error" : undefined} aria-invalid={Boolean(errors.recipient)} />
              <Button type="button" variant="outline" onClick={() => void resolveRecipient()} disabled={resolving || !recipient.trim()} className="min-h-11">{resolving ? "Verifying…" : "Verify recipient"}</Button>
            </div>
            {errors.recipient && <p id="recipient-error" role="alert" className="text-sm text-red-700">{errors.recipient}</p>}
          </div>
          {preview && <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4" aria-live="polite">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">{preview.avatarInitials}</div>
            <div><p className="font-semibold text-emerald-950">{preview.displayName}</p><p className="text-sm text-emerald-800">{preview.maskedIdentifier}</p></div>
            <ShieldCheck aria-label="Verified recipient" className="ml-auto size-5 text-emerald-700" />
          </div>}
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <div className="grid gap-2">
              <Label htmlFor="transfer-amount">Amount</Label>
              <Input id="transfer-amount" type="text" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => { setAmount(event.target.value); setErrors((current) => ({ ...current, amount: undefined })); resetAttempt(); }} aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? "amount-error" : undefined} />
              {errors.amount && <p id="amount-error" role="alert" className="text-sm text-red-700">{errors.amount}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="transfer-currency">Currency</Label>
              <Select value={currency} onValueChange={(value: TransferCurrency) => { setCurrency(value); resetAttempt(); }}>
                <SelectTrigger id="transfer-currency" aria-label="Currency"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="NGN">NGN</SelectItem><SelectItem value="GHS">GHS</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <p className="-mt-3 text-xs text-slate-500">Available: {selectedWallet ? formatTransferMoney(String(selectedWallet.balance), currency) : `${currency} —`}</p>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3"><Label htmlFor="transfer-note">Note (optional)</Label><span className={`text-xs tabular-nums ${countTransferNoteCodePoints(note) > 120 ? "text-red-700" : "text-slate-500"}`}>{countTransferNoteCodePoints(note)}/120</span></div>
            <Input id="transfer-note" value={note} onChange={(event) => { setNote(event.target.value); setErrors((current) => ({ ...current, note: countTransferNoteCodePoints(event.target.value.trim()) > 120 ? "Keep the note to 120 characters or fewer." : undefined })); resetAttempt(); }} aria-invalid={Boolean(errors.note)} aria-describedby={errors.note ? "note-error" : undefined} />
            {errors.note && <p id="note-error" role="alert" className="text-sm text-red-700">{errors.note}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="transfer-pin">Transaction PIN</Label>
            <Input id="transfer-pin" type="password" inputMode="numeric" autoComplete="off" placeholder="4 to 6 digits" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} />
            <p className="text-xs text-slate-500">Your PIN authorizes this transfer and is never shown in the receipt.</p>
          </div>
          {pageError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{pageError}</div>}
          {attempt && pageError ? <Button onClick={() => void submitAttempt()} disabled={submitting || pinStatus.data.locked} className="min-h-12"><RefreshCw aria-hidden="true" className="size-4" />{submitting ? "Retrying…" : "Retry transfer"}</Button> : <Button onClick={openReview} disabled={submitting || Boolean(moneyGate) || pinStatus.data.locked} className="min-h-12"><Send aria-hidden="true" className="size-4" />Review transfer</Button>}
        </CardContent>
      </Card>

      <Dialog open={reviewOpen} onOpenChange={(open) => !submitting && setReviewOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Review transfer</DialogTitle><DialogDescription>Check every detail. Transfers complete immediately after confirmation.</DialogDescription></DialogHeader>
          {activeTransfer && <dl className="rounded-xl border border-slate-200 px-4">
            <DetailRow label="Recipient" value={preview?.maskedIdentifier ?? "—"} />
            {reviewRows.map((row) => <DetailRow key={row.label} label={row.label} value={row.value} testId={row.label === "Fee" ? "review-fee" : row.label === "Total debit" ? "review-total" : undefined} />)}
            {activeTransfer.note && <DetailRow label="Note" value={activeTransfer.note} />}
          </dl>}
          {pageError && <p role="alert" className="text-sm font-medium text-red-700">{pageError}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setReviewOpen(false)} disabled={submitting}>Go back</Button><Button onClick={() => void submitAttempt()} disabled={submitting}>{submitting ? "Sending…" : "Confirm transfer"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
