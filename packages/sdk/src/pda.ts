import { PDA_SEEDS, PROGRAM_ID } from "@paycheck-router/shared";
import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
} from "@solana/kit";

const addressBytes = (value: Address) => getAddressEncoder().encode(value);

async function derive(seeds: (string | Uint8Array | ReturnType<typeof addressBytes>)[]) {
  const [pda] = await getProgramDerivedAddress({ programAddress: PROGRAM_ID, seeds });
  return pda;
}

export function findConfigPda(): Promise<Address> {
  return derive([PDA_SEEDS.config]);
}

export function findAssetPda(mint: Address): Promise<Address> {
  return derive([PDA_SEEDS.asset, addressBytes(mint)]);
}

export function findRouterPda(owner: Address): Promise<Address> {
  return derive([PDA_SEEDS.router, addressBytes(owner)]);
}

export function findAuthorityPda(router: Address): Promise<Address> {
  return derive([PDA_SEEDS.authority, addressBytes(router)]);
}

export function findConvertAuthorityPda(router: Address, mint: Address): Promise<Address> {
  return derive([PDA_SEEDS.convert, addressBytes(router), addressBytes(mint)]);
}

export function findPaycheckPda(router: Address, seq: bigint): Promise<Address> {
  return derive([PDA_SEEDS.paycheck, addressBytes(router), getU64Encoder().encode(seq)]);
}
