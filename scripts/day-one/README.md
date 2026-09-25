# Day-one checks

Four facts the design depends on, checked against a fresh Surfpool fork of mainnet before any product code was written.

| Check | Why it matters |
| --- | --- |
| Surfnet clock stays within 5 s of wall time | The program rejects Pyth prices older than 30 s by the onchain clock |
| A Jupiter `/swap/v2/build` route executes on the fork | Every slice swaps through Jupiter; the fork must run real routes against copied pools |
| `getSignaturesForAddress` and `getTransaction` return fork-local transactions | The reconcile sweep detects paychecks this way when no webhook exists |
| A `/swap/v2/build` instruction runs inside CPI with a PDA as taker | The router program swaps as its Authority PDA, never holding user keys |

The CPI check deploys `cpi-probe/`, a throwaway program that only forwards the Jupiter instruction with `invoke_signed`. It is not part of the product.

```bash
surfpool start --network mainnet --no-tui --no-studio -y --airdrop-amount 0
(cd scripts/day-one/cpi-probe && anchor keys sync && anchor build && solana program deploy --url http://127.0.0.1:8899 \
  --program-id target/deploy/cpi_probe-keypair.json target/deploy/cpi_probe.so)
CPI_PROBE_PROGRAM_ID=<deployed id> pnpm day-one -- --cpi
```

Reports land in `evidence/day-one/`, including failed runs.
