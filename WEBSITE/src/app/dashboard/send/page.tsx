import DashboardLayout from "@/components/layout/dashboard-layout";
import { InternalTransferForm } from "@/components/transfers/internal-transfer-form";

export default function SendMoneyPage() {
  return (
    <DashboardLayout>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 animate-trustpay-fade-up">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">TrustPay transfer</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Send money</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">Move NGN or GHS instantly to another verified TrustPay wallet. Recipient details remain masked for privacy.</p>
        </div>
        <InternalTransferForm />
      </main>
    </DashboardLayout>
  );
}
