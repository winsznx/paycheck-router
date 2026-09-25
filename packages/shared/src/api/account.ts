import { z } from "zod";
import { EligibilityStatus } from "./auth.ts";
import { AddressString, CountryCode, IsoDateTime, U64String, Uuid } from "./common.ts";

export const WalletKind = z.enum(["embedded", "external"]);

export const Wallet = z.object({
  id: Uuid,
  address: AddressString,
  kind: WalletKind,
  verifiedAt: IsoDateTime.nullable(),
  sanctionsStatus: z.enum(["unchecked", "clear", "flagged", "not_configured"]),
  /** The owner's USDC associated token account, the router's pay-in account. */
  payInAta: AddressString,
  payInAtaExists: z.boolean(),
  usdcBalance: U64String,
  routerPda: AddressString,
  hasRouter: z.boolean(),
});
export type Wallet = z.infer<typeof Wallet>;

export const WalletsResponse = z.object({ wallets: z.array(Wallet) });
export type WalletsResponse = z.infer<typeof WalletsResponse>;

/** `GET /me`. */
export const Me = z.object({
  id: Uuid,
  email: z.string().nullable(),
  locale: z.string(),
  refCurrency: z.string(),
  countryDeclared: CountryCode.nullable(),
  countryIp: CountryCode.nullable(),
  eligibilityStatus: EligibilityStatus,
  tosVersion: z.string().nullable(),
  riskAckVersion: z.string().nullable(),
  ackedAt: IsoDateTime.nullable(),
  wallets: z.array(z.object({ address: AddressString, kind: WalletKind })),
  createdAt: IsoDateTime,
});
export type Me = z.infer<typeof Me>;

/** `PATCH /me`. */
export const PatchMeRequest = z
  .object({
    locale: z.enum(["en", "es-419", "pt-BR", "fr"]),
    refCurrency: z.string().regex(/^[A-Z]{3}$/),
    countryDeclared: CountryCode,
    email: z.email().nullable(),
  })
  .partial();
export type PatchMeRequest = z.infer<typeof PatchMeRequest>;

/** `POST /eligibility/attest`. */
export const EligibilityAttestRequest = z.object({
  countryDeclared: CountryCode,
  /** The user declares they are not a US person. `true` blocks the account. */
  usPerson: z.boolean(),
  tosVersion: z.string().min(1),
  riskAckVersion: z.string().min(1),
});
export type EligibilityAttestRequest = z.infer<typeof EligibilityAttestRequest>;

export const EligibilityResponse = z.object({
  status: EligibilityStatus,
  countryDeclared: CountryCode,
  countryIp: CountryCode.nullable(),
  /** The IP country differs from the declared one; the app asks the user to confirm. */
  countryMismatch: z.boolean(),
  sanctions: z.array(
    z.object({
      address: AddressString,
      status: z.enum(["unchecked", "clear", "flagged", "not_configured"]),
    }),
  ),
});
export type EligibilityResponse = z.infer<typeof EligibilityResponse>;

/** `POST /waitlist`. */
export const WaitlistRequest = z.object({
  email: z.email(),
  country: CountryCode.optional(),
  source: z.string().max(64).optional(),
  turnstileToken: z.string().min(1),
});
export type WaitlistRequest = z.infer<typeof WaitlistRequest>;

export const WaitlistResponse = z.object({ ok: z.literal(true) });
export type WaitlistResponse = z.infer<typeof WaitlistResponse>;
