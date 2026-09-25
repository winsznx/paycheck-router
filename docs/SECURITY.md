# Security and trust model

No key Paycheck Router holds can move a worker's money anywhere except into shares in that worker's own wallet, at a checked price, up to the worker's own limits. The one power that could change that, a program upgrade, sits behind a 2-of-3 Squads multisig with a 48-hour timelock on mainnet.

Until the mainnet deploy, the program runs only on Surfpool forks of mainnet. There, every role uses a fresh fork-only keypair that holds nothing on mainnet, and the admin and upgrade authority is a fork-only key rather than the Squads vault.

## Who can do what

| Actor | Can | Cannot | If compromised |
| --- | --- | --- | --- |
| Worker | Create, change, pause and close their router; revoke the allowance at any time with one SPL `revoke` | — | They own the wallet |
| Upgrade authority (Squads 2-of-3, 48 h timelock on mainnet) | Replace program code | Act with one signer or before the timelock | Could change the rules for every router. Users are emailed when an upgrade is proposed so they can revoke first, and builds are verifiable |
| Admin (the same Squads vault) | Fee up to 0.50%, treasury, attester, feeds and bands inside compiled caps, asset status | Exceed the compiled caps or touch user funds | Could point an asset at the wrong feed; the timelock and a symbol-match check guard against that |
| Pause guardian | Set the global pause | Unpause or change anything else | Could halt service, never move funds |
| Crank | Execute, expire and close; post Pyth prices; pay fees | Redirect output, overspend a slice, skip the guard | Could buy at the worst price inside the band, or stop executing. Anyone can run the open-source crank |
| Recorder | Record or skip an inflow | Record more than the real new balance | Could invest an inflow that wasn't pay (still inside the invest % and daily cap) or skip a paycheck. Owners can take recording over |
| Attester | Sign PreStocks marks | Affect listed-equity slices | Could make PreStocks slices buy inside the band over a wrong mark. A 20% move breaker, a Pyth cross-check for OpenAI and Anthropic and a 10% band cap bound it |
| Sponsor | Pay setup fees and rent | Sign anything it didn't build | Could be drained by abuse; rate limits cap it |
| Jupiter | Route swaps | Deliver less than the minimum | Even a malicious route must deliver at least the computed minimum to the owner, or the transaction fails |
| Pyth | Publish prices | — | Bad prints are bounded by the 30 s freshness, confidence and band checks |
| Backed (xStocks), PreStocks, Circle | Pause or move their tokens under their own terms; freeze USDC | — | Disclosed in the risk terms; a paused mint makes slices wait |

## What the program enforces on every buy

1. The shares land only in a token account owned by the router's owner, with the asset's mint.
2. The owner's USDC falls by exactly the slice amount.
3. Every Authority token account the transaction touches ends at zero.
4. No slice executes on a stale price, a wide confidence interval or off-peg USDC.
5. Every executed slice delivers at least the minimum the program computed.
6. A paycheck's slices add up to at most inflow × invest share.
7. USDC already in the wallet when the router is created is never treated as pay.
8. A paused router or paused protocol records and executes nothing.
9. The fee never exceeds 0.50%.
10. Replaying any instruction changes nothing.
11. Closing an account refunds rent to whoever paid it.
12. A conversion authority can move only its own pre-IPO token, and only into that token's conversion target.

Each one is a named test in `programs/paycheck_router`.

## Threats covered by tests

Output redirected by the crank; a route pulling extra USDC; stale, wide or spoofed prices; forged or malformed PreStocks attestations; sandwiching (bounded by the minimum); a front-run record; another app replacing the delegate; a wrong registry feed; spoofed webhooks; sponsor farming; Token-2022 surprises such as new transfer hooks or multiplier changes mid-slice; rounding games; oversized slices (capped at 5,000 USDC each).

## Reporting a vulnerability

The program binary carries a `security_txt!` block with the contact and policy. Please report privately through GitHub security advisories on this repository before disclosing.
