import { api } from "@paycheck-router/shared";
import { z } from "zod";

type Operation = {
  method: "get" | "post" | "patch";
  path: string;
  summary: string;
  auth: "public" | "user";
  query?: z.ZodType;
  body?: z.ZodType;
  response?: z.ZodType;
  status?: number;
};

/** Every route this Worker serves, with the shared Zod contract it validates against. */
const OPERATIONS: Operation[] = [
  {
    method: "get",
    path: "/auth/nonce",
    summary: "Single-use SIWS nonce",
    auth: "public",
    response: api.NonceResponse,
  },
  {
    method: "post",
    path: "/auth/siws",
    summary: "Sign in with Solana",
    auth: "public",
    body: api.SiwsRequest,
    response: api.SessionResponse,
  },
  {
    method: "post",
    path: "/auth/refresh",
    summary: "Rotate the refresh token",
    auth: "public",
    body: api.RefreshRequest,
    response: api.SessionResponse,
  },
  {
    method: "post",
    path: "/auth/logout",
    summary: "Revoke the session family",
    auth: "public",
    status: 204,
  },
  {
    method: "get",
    path: "/me",
    summary: "Profile and eligibility",
    auth: "user",
    response: api.Me,
  },
  {
    method: "patch",
    path: "/me",
    summary: "Update profile",
    auth: "user",
    body: api.PatchMeRequest,
    response: api.Me,
  },
  {
    method: "post",
    path: "/eligibility/attest",
    summary: "Record declarations and run checks",
    auth: "user",
    body: api.EligibilityAttestRequest,
    response: api.EligibilityResponse,
  },
  {
    method: "get",
    path: "/wallets",
    summary: "Linked wallets with pay-in balances",
    auth: "user",
    response: api.WalletsResponse,
  },
  {
    method: "get",
    path: "/assets",
    summary: "Registry with market status and prices",
    auth: "public",
    response: api.AssetsResponse,
  },
  {
    method: "get",
    path: "/quote/preview",
    summary: "Price a hypothetical paycheck now",
    auth: "user",
    query: api.QuotePreviewQuery,
    response: api.QuotePreviewResponse,
  },
  {
    method: "get",
    path: "/routers",
    summary: "The user's routers",
    auth: "user",
    response: api.RoutersResponse,
  },
  {
    method: "post",
    path: "/routers/tx/create",
    summary: "Setup transaction",
    auth: "user",
    body: api.CreateRouterTxRequest,
    response: api.TxBuildResponse,
  },
  {
    method: "post",
    path: "/tx/submit",
    summary: "Broadcast a signed transaction",
    auth: "user",
    body: api.SubmitTxRequest,
    response: api.SubmitTxResponse,
  },
  {
    method: "get",
    path: "/paychecks",
    summary: "Paycheck history",
    auth: "user",
    response: api.PaychecksResponse,
  },
  {
    method: "get",
    path: "/paychecks/{id}",
    summary: "Paycheck detail with attempts and verification",
    auth: "user",
    response: api.PaycheckDetail,
  },
  {
    method: "post",
    path: "/legs/{id}/tx/buy-now",
    summary: "Buy a waiting slice now with a chosen band",
    auth: "user",
    body: api.BuyNowTxRequest,
    response: api.TxBuildResponse,
  },
  {
    method: "post",
    path: "/legs/{id}/tx/cancel",
    summary: "Cancel a waiting slice",
    auth: "user",
    response: api.TxBuildResponse,
  },
  {
    method: "get",
    path: "/portfolio",
    summary: "Holdings, value and cost basis",
    auth: "user",
    response: api.PortfolioResponse,
  },
  {
    method: "get",
    path: "/proof",
    summary: "Public proof: campaign and recent slices",
    auth: "public",
    response: api.ProofResponse,
  },
  {
    method: "get",
    path: "/proof/legs/{signature}",
    summary: "Public proof for one slice",
    auth: "public",
    response: api.ProofLeg,
  },
  {
    method: "get",
    path: "/status",
    summary: "Component health",
    auth: "public",
    response: api.StatusResponse,
  },
  {
    method: "get",
    path: "/demo/status",
    summary: "Fork only: is the demo fork up, and when it resets",
    auth: "public",
    response: api.DemoStatus,
  },
  {
    method: "post",
    path: "/demo/fund",
    summary: "Fork only: fork SOL and USDC for the signed-in wallet, once per fork",
    auth: "user",
    response: api.DemoFundResponse,
  },
  {
    method: "post",
    path: "/demo/paycheck",
    summary: "Fork only: employer-1 pays the signed-in wallet's router",
    auth: "user",
    body: api.DemoPaycheckRequest,
    response: api.DemoPaycheckResponse,
  },
  {
    method: "post",
    path: "/demo/simulate",
    summary: "Fork only: simulate a transaction on the demo fork",
    auth: "user",
    body: api.DemoSimulateRequest,
    response: api.DemoSimulateResponse,
  },
  {
    method: "post",
    path: "/waitlist",
    summary: "Join the waitlist (Turnstile)",
    auth: "public",
    body: api.WaitlistRequest,
    response: api.WaitlistResponse,
    status: 201,
  },
  {
    method: "get",
    path: "/realtime",
    summary: "WebSocket upgrade to the user's event stream",
    auth: "user",
    status: 101,
  },
];

function schema(type: z.ZodType): unknown {
  return z.toJSONSchema(type, { io: "input", unrepresentable: "any" });
}

const problem = { "application/problem+json": { schema: schema(api.Problem) } };

/** OpenAPI 3.1 document generated from the shared contract (section 11.1). */
export function openApiDocument(serverUrl: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of OPERATIONS) {
    const parameters: unknown[] = [];
    for (const name of operation.path.match(/\{(\w+)\}/g) ?? []) {
      parameters.push({
        name: name.slice(1, -1),
        in: "path",
        required: true,
        schema: { type: "string" },
      });
    }
    if (operation.query instanceof z.ZodObject) {
      for (const [name, field] of Object.entries(operation.query.shape)) {
        parameters.push({ name, in: "query", required: true, schema: schema(field as z.ZodType) });
      }
    }
    const status = String(operation.status ?? 200);
    paths[operation.path] ??= {};
    paths[operation.path] = {
      ...paths[operation.path],
      [operation.method]: {
        summary: operation.summary,
        security: operation.auth === "user" ? [{ session: [] }] : [],
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(operation.body
          ? {
              requestBody: {
                required: true,
                content: { "application/json": { schema: schema(operation.body) } },
              },
            }
          : {}),
        responses: {
          [status]: operation.response
            ? {
                description: "OK",
                content: { "application/json": { schema: schema(operation.response) } },
              }
            : { description: "OK" },
          default: { description: "RFC 9457 problem", content: problem },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Paycheck Router core API", version: "1.0.0" },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        session: { type: "http", scheme: "bearer", bearerFormat: "JWT (EdDSA)" },
      },
    },
    paths,
  };
}
