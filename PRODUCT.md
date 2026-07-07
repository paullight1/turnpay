# Product

## Register

product

## Users

Nigerians and Ghanaians (largely mobile-first, Android-heavy) who need to move money and pay for everyday services: GHS ↔ NGN currency exchange, airtime, data bundles, cable TV (DStv/GOtv/StarTimes), and electricity tokens. They use the app in short, goal-driven bursts — "buy ₦500 MTN airtime now", "pay NEPA before the light goes off" — often on mid-range devices and patchy networks. Trust with money is the deciding factor for retention.

## Product Purpose

TrustPay is a fintech super-app for West Africa: send, receive, exchange, and pay bills in one secure platform. Flutter mobile app (this repo's APP/), NestJS backend, Next.js web/admin. Success = users complete a purchase in under 30 seconds, feel certain about what they were charged, and come back for repeat purchases (recents/rebuy loops). VTU margins and exchange spread are the revenue engine, so the purchase flows are the money pages.

## Brand Personality

Bold, energetic, youthful — but never at the expense of money-clarity. Vibrant color and confident motion (Cash App / Kuda's louder moments) wrapped around flows that are absolutely unambiguous about amounts, fees, and status. Voice: direct, warm, second-person ("You'll get 2GB — ₦1,500").

## References

- **OPay** — one-screen airtime/data purchase, smart recents, aggressive shortcuts to repeat purchases.
- **Kuda** — clean minimal flows, strong typography, calm confident color when it matters.

## Anti-references

- **Cluttered agent-app style** — dense grids of 30 tiny services, promo banners, badges everywhere.
- **Boring bank forms** — plain stacked text fields with no hierarchy, feedback, or personality.
- **Web-wrapper feel** — anything that feels like an embedded website instead of a native app.

## Design Principles

1. **Money is never ambiguous.** Amount, fee, and total are visible before every confirm; status (pending/delivered/failed/refunded) is always explicit.
2. **The fastest path is a repeat purchase.** Recents, saved numbers, and one-tap rebuy beat any pretty empty form.
3. **Energy in the chrome, calm in the numbers.** Brand color and motion carry personality; figures and confirmations stay high-contrast and quiet.
4. **Design for a ₦20k Android on 3G.** Skeletons over spinners, optimistic-but-honest states, no heavy assets.
5. **Every failure has a next step.** Failed purchase → clear reason + retry/refund path, never a dead end.

## Accessibility & Inclusion

- Body text ≥ 4.5:1 contrast in both dark and light themes (both ship today; dark is default).
- Touch targets ≥ 48dp; flows operable one-handed on small screens.
- Respect reduced-motion OS setting for all non-essential animation.
- Plain-language copy; no banking jargon (users span wide literacy/English-fluency range).
