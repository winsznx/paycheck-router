# Evaluation campaign

The claims are tested before they're made. Until the program is on mainnet, every case runs on its own fresh Surfpool fork of mainnet during the US regular session, with the fork's start slot in its manifest, and every number is labelled fork.

## Hypothesis

For the same paychecks, routing through Paycheck Router instead of a 2% CEX purchase, manual Jupiter swaps or Jupiter Recurring with a manual deposit each payday lowers all-in cost per $100 invested, takes manual steps per payday to zero, and avoids buying outside a fair band.

## Arms

| Arm | What it is | How it is measured |
| --- | --- | --- |
| A. CEX route | Tokenized stocks bought on Luno in Nigeria | Published 2% per-trade fee |
| B. Manual onchain | The worker swaps on Jupiter each payday | Step count from a scripted flow; price from Jupiter quotes at the same timestamps |
| C. Jupiter Recurring | A recurring order funded by a manual deposit each payday | One manual deposit per payday; runs on a schedule, with no oracle check |
| D. Naive router | The same automation with the guard removed: buy at the Jupiter quote immediately | Replayed from the recorded quotes at each first attempt |
| Reference model | `packages/guard-math`, an independent TypeScript version of the guard | Must match the program to the base unit |

## Cases on the fork

| Case | Scenario | Expected outcome |
| --- | --- | --- |
| P1 Positive | Paycheck in the regular session, liquid asset | Executes, delivers at least the minimum, Verified |
| P2 Healthy control | Untagged sender under "tagged only"; inflow below the minimum; self-transfer | Skipped, nothing moves |
| P3 Insufficient evidence | SPYx slice with the clock moved to a weekend (no 24/7 feed) | PriceStale, waits for the open. The Monday fill is shown only on mainnet |
| P4 Harmful action | A test crank submits a route paying another account, and one that pulls extra USDC | DestinationOwnerMismatch or OutputBelowMinimum; InputOverspent |
| P4 Real market | OpenAI PreStocks trading about 30% over mark | OutputBelowMinimum, waits |
| P5 Stale context | Attestation older than 300 s; Scaled UI multiplier change during a pending leg (fork time travel) | AttestationStale; the minimum uses the new multiplier |
| P6 Replay | Resubmit `record_paycheck` and `execute_leg` | NoNewInflow; LegNotPending |
| P7 Ablations | Arm D on the same paychecks; Jupiter's own price as the only reference; the same slices costed on Ethereum from the gas oracle | Overpayment the guard prevented; slices that would have filled out of band; computed (not executed) Ethereum cost |
| P8 Breadth | 9 xStocks and 7 PreStocks names, 3 employer wallets, $20 to $5,000 | The same guarantees across all |

## Decision rules, fixed before the runs

| Claim | Pass | Fail |
| --- | --- | --- |
| Cost | Median all-in cost per $100 ≤ $0.50 | Above $1.00: the cost claim comes off every public surface |
| Guard | At least one slice waited and later filled in band, with measured overpayment avoided | The guard is described only as protection, with the live PreStocks premium as its evidence |
| Integrity | 100% of executed slices Verified | Any Unverified slice is published with its diff before any claim |
| Speed | Not evaluated on a fork | A fork has no network contention |

## Results (fork, Sep 25, 2026)

From [`evidence/campaign/summary.json`](../evidence/campaign/summary.json), which `pnpm verify:campaign` rebuilds from the raw artifacts.

| Measure | Value |
| --- | --- |
| Runs | 32 (pass 4, fail 14, blocked 2, infrastructure 12) |
| Executed slices verified | 20 of 20 |
| All-in cost per $100 (median) | $1.00 (n=15): xStocks $0.24, PreStocks $1.75 including the issuer's transfer fee |
| Baseline medians (computed at the same timestamps and amounts) | CEX 2.00%, manual Jupiter 1.75%, Jupiter Recurring 1.85%, product 1.00% |
| Manual steps per payday | Product 0; CEX 2; manual Jupiter 6; Jupiter Recurring 1 |
| Guard ablation (Arm D, replayed) | $129.95 of overpayment prevented across 26 slices |
| Oracle ablation (replayed) | 7 of 26 slices would have filled out of band |

Decision rules: integrity passes; cost is inconclusive; the guard rule fails, so the guard is described only as protection; speed is not evaluated. Case-by-case results, failures included, are in [GATES.md](GATES.md).
