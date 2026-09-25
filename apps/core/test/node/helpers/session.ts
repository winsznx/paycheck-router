import { api } from "@paycheck-router/shared";
import { type KeyPairSigner, signBytes } from "@solana/kit";
import type { testApp, testEnv } from "./app.ts";
import { siwsMessageText } from "./siws.ts";

/** Signs in through the real SIWS routes and returns the issued session. */
export async function sessionFor(
  app: ReturnType<typeof testApp>,
  env: ReturnType<typeof testEnv>,
  signer: KeyPairSigner,
): Promise<api.SessionResponse> {
  const nonce = api.NonceResponse.parse(await (await app.request("/auth/nonce", {}, env)).json());
  const message = siwsMessageText({
    domain: nonce.domain,
    address: signer.address,
    uri: nonce.uri,
    chainId: nonce.chainId,
    nonce: nonce.nonce,
    issuedAt: new Date().toISOString(),
  });
  const signature = await signBytes(signer.keyPair.privateKey, new TextEncoder().encode(message));
  const res = await app.request(
    "/auth/siws",
    {
      method: "POST",
      body: JSON.stringify({
        address: signer.address,
        message,
        signature: Buffer.from(signature).toString("base64"),
      }),
      headers: { "content-type": "application/json" },
    },
    env,
  );
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return api.SessionResponse.parse(await res.json());
}

export const bearer = (session: api.SessionResponse) => ({
  authorization: `Bearer ${session.accessToken}`,
});
