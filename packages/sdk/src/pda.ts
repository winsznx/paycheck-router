import { PDA_SEEDS, PROGRAM_ID } from "@paycheck-router/shared";
import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
} from "@solana/kit";

/** PDAs whose seeds the IDL cannot express; the rest come from the generated client. */
export async function findPaycheckPda(router: Address, seq: bigint): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [PDA_SEEDS.paycheck, getAddressEncoder().encode(router), getU64Encoder().encode(seq)],
  });
  return pda;
}

export async function findConvertAuthorityPda(router: Address, mint: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      PDA_SEEDS.convert,
      getAddressEncoder().encode(router),
      getAddressEncoder().encode(mint),
    ],
  });
  return pda;
}
