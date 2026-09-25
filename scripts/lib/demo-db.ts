import { readdirSync, readFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export type DemoDatabase = {
  url: string;
  port: number;
  stop(): Promise<void>;
};

const SSL_REQUEST = 80877103;
const CANCEL_REQUEST = 80877102;
const PROTOCOL_3 = 196608;
/** Messages after which PGlite must answer before the client sends more. */
const RESPOND_AFTER = new Set(["S", "Q", "H", "p"]);
/** Messages that end a client's hold on the session: Sync, simple Query, password. */
const RELEASE_AFTER = new Set(["S", "Q", "p"]);

/** A FIFO mutex: whoever holds it owns PGlite's single session. */
function sessionLock() {
  let tail: Promise<void> = Promise.resolve();
  return async (): Promise<() => void> => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });
    const previous = tail;
    tail = previous.then(() => held);
    await previous;
    return release;
  };
}

/**
 * Serves one PGlite database to several clients. PGlite has a single session, so a client holds
 * it from the first message of an extended-protocol unit until that unit's Sync (or a simple
 * Query) has been answered; other clients wait their turn. Interleaving two clients' Parse and
 * Bind messages on the shared session is what broke concurrent requests before.
 */
function serve(db: PGlite, port: number): Promise<{ close(): Promise<void> }> {
  const acquire = sessionLock();
  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    let buffer = Buffer.alloc(0);
    let pending: Buffer[] = [];
    let started = false;
    let release: (() => void) | null = null;
    let chain: Promise<void> = Promise.resolve();

    const execute = async (unit: Buffer, releaseAfter: boolean) => {
      if (!release) release = await acquire();
      try {
        await db.execProtocolRawStream(new Uint8Array(unit), {
          onRawData: (data) => {
            if (socket.writable) socket.write(Buffer.from(data));
          },
        });
      } finally {
        if (releaseAfter && release) {
          release();
          release = null;
        }
      }
    };

    const enqueue = (unit: Buffer, releaseAfter: boolean) => {
      chain = chain
        .then(() => execute(unit, releaseAfter))
        .catch((error: unknown) => {
          console.error("demo database: protocol error", error);
          socket.destroy();
        });
    };

    const dropHold = () => {
      sockets.delete(socket);
      chain = chain.then(() => {
        if (release) {
          release();
          release = null;
        }
      });
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (!started) {
          if (buffer.length < 8) return;
          const length = buffer.readInt32BE(0);
          const code = buffer.readInt32BE(4);
          if (code === SSL_REQUEST) {
            buffer = buffer.subarray(8);
            socket.write("N");
            continue;
          }
          if (code === CANCEL_REQUEST) {
            buffer = buffer.subarray(length);
            continue;
          }
          if (code !== PROTOCOL_3 || buffer.length < length) return;
          const startup = Buffer.from(buffer.subarray(0, length));
          buffer = buffer.subarray(length);
          started = true;
          enqueue(startup, true);
          continue;
        }
        if (buffer.length < 5) return;
        const length = 1 + buffer.readInt32BE(1);
        if (buffer.length < length) return;
        const message = Buffer.from(buffer.subarray(0, length));
        const type = String.fromCharCode(message[0] ?? 0);
        buffer = buffer.subarray(length);
        if (type === "X") {
          socket.end();
          return;
        }
        pending.push(message);
        if (RESPOND_AFTER.has(type)) {
          const unit = Buffer.concat(pending);
          pending = [];
          enqueue(unit, RELEASE_AFTER.has(type));
        }
      }
    });
    socket.on("close", dropHold);
    socket.on("error", dropHold);
  });

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      resolveServer({
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      }),
    );
  });
}

/**
 * The `demo` environment's database: Postgres 17 (PGlite) served over the Postgres wire protocol
 * on the port Hyperdrive's `localConnectionString` points at, built from the same
 * `supabase/migrations` and `seed.sql` that Supabase applies in staging and production.
 */
export async function startDemoDatabase(options: {
  repoRoot: string;
  port?: number;
}): Promise<DemoDatabase> {
  const port = options.port ?? 54322;
  const supabase = resolve(options.repoRoot, "supabase");
  const db = await PGlite.create();
  const migrations = readdirSync(resolve(supabase, "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    await db.exec(readFileSync(resolve(supabase, "migrations", file), "utf8"));
  }
  await db.exec(readFileSync(resolve(supabase, "seed.sql"), "utf8"));
  const server = await serve(db, port);
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    port,
    async stop() {
      await server.close();
      await db.close();
    },
  };
}
