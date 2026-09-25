import { address } from "@solana/kit";

export const PROGRAM_ID = address("PayEFo1ZAPXKf5H4DoqrsEceYzdSvXJBAGBD7AMQY6H");

export const JUPITER_PROGRAM_ID = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
export const PYTH_RECEIVER_PROGRAM_ID = address("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
export const TOKEN_PROGRAM_ID = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const ED25519_PROGRAM_ID = address("Ed25519SigVerify111111111111111111111111111");
export const INSTRUCTIONS_SYSVAR_ID = address("Sysvar1nstructions1111111111111111111111111");
export const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

export const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDC_DECIMALS = 6;

export const PDA_SEEDS = {
  config: "config",
  asset: "asset",
  router: "router",
  authority: "authority",
  convert: "convert",
  paycheck: "paycheck",
} as const;
