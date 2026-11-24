# GAYZE monetisation plan

Status: proposal, nothing is built. No billing code exists in the app yet.

## Principles
1. **Free is good.** Free users are what make the app worth paying for. Grindr's "unusable free tier" is its most common complaint; we do not copy it.
2. **Safety stays free for everyone.** Safe-meet plans, blocking, reporting, age checks and call safety are never paywalled.
3. **No ads built on user data.** Sexuality plus location is the most sensitive data there is. Revenue comes from members, not from advertisers.
4. **Charge after density.** GAYZE is a local network. Start charging in a city only once people there are sending Gayzes and coming back.

## What the market shows (sources: Grindr investor results, Feb 2026 and Q3 2025 shareholder letter)
- Grindr 2025 revenue $439.9M (+28%); 2026 guidance above $528M.
- Q3 2025: 15.1M monthly users, 1.3M paying (8.6%), about $24.70 per payer per month. 1.3M x $24.70 x 3 months is about $96M, matching its reported Q3 direct revenue.
- Pricing seen (varies by region and over time, treat as indicative): about $22.99/month and $14.99/week for XTRA.
- Not verified: Scruff, Hornet and Feeld prices.
- A realistic early target for GAYZE is 1-3% of users paying; 8.6% reflects years of scale.

## Proposed offer
| | Free | GAYZE Plus (about GBP 9.99/month, GBP 59.99/year, free trial) |
|---|---|---|
| Discover, send and receive Gayzes, chat, calls | Yes | Yes |
| Safe-meet plans, blocking, reporting | Yes | Yes |
| Gayzes per day | Limited | More, no wait before another to the same person |
| Active intents | One | Several at once, longer-lasting |
| Filters | Basic | By activity and connection type |
| Privacy | Standard | Hide from chosen people, travel mode |
| See who viewed you | No | Yes |
| Album space | Standard | More |

Boosts: one-off GBP 1.99-2.99 to be featured in Discover for an hour.

Later: venue and event partnerships (sponsored listings by place, not by tracking people), once there is density.

## Costs and platform rules to plan for
- Apple takes 15-30% of in-app purchases; 15% needs the Small Business Program (under $1M/year).
- UK rules on steering buyers to web checkout differ from the US; check before building web checkout.
- Per-user costs: calls (TURN), SMS, hosting, age verification. Price must cover them.

## Numbers to watch
Free-to-paid conversion, trial-to-paid, monthly churn, revenue per payer, 7- and 30-day retention per city, share of Gayzes that are accepted.

## Build order (each step needs its own go-ahead)
1. Paywall design with no real payments.
2. RevenueCat and App Store subscriptions, switched off by default.
3. Server-side entitlement checks so features cannot be unlocked from the client.
4. Boosts.
