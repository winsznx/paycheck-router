import { z } from "zod";
import { AddressString, IsoDateTime, SignatureString, U64String, Uuid } from "./common.ts";
import { PythPrice } from "./market.ts";
import { Leg, PaycheckSummary, Verification } from "./paychecks.ts";
import { Router } from "./routers.ts";

/**
 * `GET /realtime` upgrades to a WebSocket. Authenticate with the session cookie (web) or with
 * `Sec-WebSocket-Protocol: paycheck-router.v1, bearer.<accessToken>`; the server answers with
 * `paycheck-router.v1`.
 */
export const REALTIME_PROTOCOL = "paycheck-router.v1";
export const REALTIME_BEARER_PREFIX = "bearer.";
export const REALTIME_REPLAY_LIMIT = 500;

const LegEventData = z.object({ routerId: Uuid, paycheckId: Uuid, leg: Leg });

export const PaycheckDetectedData = z.object({
  routerId: Uuid,
  routerPda: AddressString,
  amount: U64String,
  sender: AddressString.nullable(),
  signature: SignatureString.nullable(),
  detectedAt: IsoDateTime,
});

export const ServerEventData = {
  "paycheck.detected": PaycheckDetectedData,
  "paycheck.recorded": z.object({ routerId: Uuid, paycheck: PaycheckSummary }),
  "leg.waiting": LegEventData,
  "leg.executing": LegEventData.extend({ attemptNo: z.number().int() }),
  "leg.executed": LegEventData,
  "leg.verified": LegEventData.extend({ verification: Verification }),
  "leg.unverified": LegEventData.extend({ verification: Verification }),
  "leg.expired": LegEventData,
  "leg.cancelled": LegEventData,
  "router.updated": z.object({ router: Router }),
  "allowance.low": z.object({
    routerId: Uuid,
    remaining: U64String,
    nextPaycheckEstimate: U64String.nullable(),
  }),
  "conversion.reminder": z.object({
    mint: AddressString,
    deadline: IsoDateTime,
    autoConvert: z.boolean(),
  }),
  "price.tick": z.object({ mint: AddressString, symbol: z.string(), price: PythPrice }),
  "status.changed": z.object({ component: z.string(), status: z.string(), detail: z.string() }),
} as const;

export type ServerEventType = keyof typeof ServerEventData;
export const ServerEventType = z.enum(
  Object.keys(ServerEventData) as [ServerEventType, ...ServerEventType[]],
);

export type ServerEventPayload<T extends ServerEventType> = z.infer<(typeof ServerEventData)[T]>;

export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

function eventSchema<T extends ServerEventType>(type: T) {
  return z.object({
    type: z.literal(type),
    id: Ulid,
    ts: IsoDateTime,
    data: ServerEventData[type],
  });
}

/** Every server event: `{ type, id (ULID), ts, data }`. */
export const ServerEvent = z.discriminatedUnion("type", [
  eventSchema("paycheck.detected"),
  eventSchema("paycheck.recorded"),
  eventSchema("leg.waiting"),
  eventSchema("leg.executing"),
  eventSchema("leg.executed"),
  eventSchema("leg.verified"),
  eventSchema("leg.unverified"),
  eventSchema("leg.expired"),
  eventSchema("leg.cancelled"),
  eventSchema("router.updated"),
  eventSchema("allowance.low"),
  eventSchema("conversion.reminder"),
  eventSchema("price.tick"),
  eventSchema("status.changed"),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;

/** Control replies that are not part of the replayable event log. */
export const ServerControl = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pong"), ts: IsoDateTime }),
  z.object({ type: z.literal("resumed"), replayed: z.number().int(), complete: z.boolean() }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type ServerControl = z.infer<typeof ServerControl>;

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("resume"), lastEventId: z.string().nullable() }),
  z.object({ type: z.literal("subscribe.prices"), mints: z.array(AddressString).max(16) }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
