import { address } from "@solana/kit";

/**
 * Public keys of the fork-only keypairs used by every surfnet run. They hold nothing on
 * mainnet; the private halves stay outside the repository.
 */
export const FORK_KEYS = {
  deployer: address("Hf1cD93ear3eJGqZUmcm912AFdSg7kbW41w5edRrHYaz"),
  admin: address("2x2osnpnuo8qcDvJeBjQsYuKk12eymLSx9deCN9BJb4m"),
  guardian: address("HMFt5dbUCAMtxq9vcirRSpgoTHGQH3tow8RbRVp5greU"),
  crank: address("7okuGKwRkoLvcGsu1wXHC3gqJQk41FZT9mo363Qsefwu"),
  recorder: address("EGaHpAB9Svfv6zW8ZcNrSEayvMPNsg1gJqQUPDYfNKqL"),
  sponsor: address("CuZDTZrPcGrRcjjFEF4UmcxgGq75Jm8eFFaxAWnSBBGA"),
  attester: address("CcJ4VfBuFwMTPgDB7EjaWkzLidqZ4ZEiEEXGViL3oJiw"),
  ops: address("9V2ngYYce5fmbjEUhYMiVFMRY7CT9qmvYXB8vzc6S1as"),
  "demo-worker": address("hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy"),
  "employer-1": address("75uzrnEcXXKf7fi53BxTBh5kTJCY7o6WD2qLvjMMShZd"),
  "employer-2": address("CNgdDTfsLRujBAhh8uVHP34gBHuHNvrE7x4wdZsh12et"),
  "employer-3": address("AwuneQgALPAye5TgJVzBfJJJfNBu7ezYwvNoyo8hHrpQ"),
} as const;

export type ForkKeyName = keyof typeof FORK_KEYS;
