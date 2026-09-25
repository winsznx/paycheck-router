import { createServer } from "node:http";
import { anthropicSignature, proofLegs, proofResponse } from "./fork-run.ts";

/**
 * Test-only stand-in for core's public endpoints, for pages rendered on the server (/proof),
 * where the browser's route mocks can't reach. Every body comes from the recorded fork run.
 */
const PORT = Number(process.env.MOCK_CORE_PORT ?? 18787);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/health") return send(200, { ok: true, anthropicSignature });
  if (url.pathname === "/proof") return send(200, proofResponse());
  const leg = /^\/proof\/legs\/([1-9A-HJ-NP-Za-km-z]+)$/.exec(url.pathname);
  if (leg) {
    const found = proofLegs().find((l) => l.signature === leg[1]);
    return found ? send(200, found) : send(404, { status: 404, code: "not_found" });
  }
  return send(503, { status: 503, code: "upstream_unavailable" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock core on http://127.0.0.1:${PORT}`);
});
