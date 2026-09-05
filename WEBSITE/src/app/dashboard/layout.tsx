import { redirect } from 'next/navigation';

// Customer wallet services are mobile-only. Staff are routed to /admin by the
// proxy; this server boundary also prevents the old pages from rendering.
export default function RetiredCustomerWebLayout() {
  redirect('/download');
}
