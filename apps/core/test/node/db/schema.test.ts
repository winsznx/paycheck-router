import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema.ts";

const supabaseDir = new URL("../../../../../supabase/", import.meta.url);
const migrationsDir = new URL("migrations/", supabaseDir);
const seedFile = new URL("seed.sql", supabaseDir);

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const UNIQUE_VIOLATION = "23505";

const schemaExports: unknown[] = Object.values(schema);
const drizzleTables = schemaExports.filter((value): value is PgTable => is(value, PgTable));
const tableNames = drizzleTables.map((table) => getTableName(table)).sort();

interface ColumnShape {
  name: string;
  type: string;
  notNull: boolean;
  hasDefault: boolean;
}

interface KeyShape {
  primaryKey: string;
  uniques: string[];
  indexes: string[];
  foreignKeys: string[];
}

const ON_DELETE: Record<string, string> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

function drizzleColumns(table: PgTable): ColumnShape[] {
  return getTableConfig(table)
    .columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
      hasDefault: column.hasDefault,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function drizzleKeys(table: PgTable): KeyShape {
  const config = getTableConfig(table);
  const columnPk = config.columns.filter((column) => column.primary).map((column) => column.name);
  const tablePk = config.primaryKeys.flatMap((pk) => pk.columns.map((column) => column.name));
  const uniques = [
    ...config.columns.filter((column) => column.isUnique).map((column) => column.name),
    ...config.uniqueConstraints.map((constraint) =>
      constraint.columns.map((column) => column.name).join(","),
    ),
  ];
  const indexes = config.indexes.map(
    (index) =>
      `${index.config.name}${index.config.unique ? " unique" : ""}${index.config.where ? " partial" : ""}`,
  );
  const foreignKeys = config.foreignKeys.map((fk) => {
    const { columns, foreignTable, foreignColumns } = fk.reference();
    const from = columns.map((column) => column.name).join(",");
    const to = foreignColumns.map((column) => column.name).join(",");
    return `${from} -> ${getTableName(foreignTable)}(${to}) on delete ${fk.onDelete ?? "no action"}`;
  });
  return {
    primaryKey: [...columnPk, ...tablePk].join(","),
    uniques: uniques.sort(),
    indexes: indexes.sort(),
    foreignKeys: foreignKeys.sort(),
  };
}

describe("database schema", () => {
  let pg: PGlite;
  let db: PgliteDatabase<typeof schema>;

  async function runSeed(): Promise<void> {
    await pg.exec(await readFile(seedFile, "utf8"));
  }

  async function publicTables(): Promise<string[]> {
    const { rows } = await pg.query<{ relname: string }>(
      `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    return rows.map((row) => row.relname).sort();
  }

  async function sqlColumns(table: string): Promise<ColumnShape[]> {
    const { rows } = await pg.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: "YES" | "NO";
      column_default: string | null;
      is_identity: "YES" | "NO";
    }>(
      `select column_name, data_type, udt_name, is_nullable, column_default, is_identity
       from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    );
    return rows
      .map((row) => ({
        name: row.column_name,
        type:
          row.data_type === "ARRAY"
            ? `${row.udt_name.replace(/^_/, "")}[]`
            : row.data_type === "USER-DEFINED"
              ? row.udt_name
              : row.data_type,
        notNull: row.is_nullable === "NO",
        hasDefault: row.column_default !== null || row.is_identity === "YES",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function sqlKeys(table: string): Promise<KeyShape> {
    const constraints = await pg.query<{
      contype: "p" | "u" | "f";
      columns: string[];
      foreign_table: string | null;
      foreign_columns: string[] | null;
      confdeltype: string;
    }>(
      `select con.contype,
         array(
           select a.attname::text from unnest(con.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
           order by k.ord
         ) as columns,
         con.confrelid::regclass::text as foreign_table,
         array(
           select a.attname::text from unnest(con.confkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum
           order by k.ord
         ) as foreign_columns,
         con.confdeltype
       from pg_constraint con
       where con.conrelid = $1::regclass and con.contype in ('p', 'u', 'f')`,
      [table],
    );
    const indexes = await pg.query<{ name: string; unique: boolean; partial: boolean }>(
      `select i.relname as name, x.indisunique as unique, x.indpred is not null as partial
       from pg_index x
       join pg_class i on i.oid = x.indexrelid
       where x.indrelid = $1::regclass
         and not exists (select 1 from pg_constraint con where con.conindid = x.indexrelid)`,
      [table],
    );
    const rows = constraints.rows;
    return {
      primaryKey: rows.find((row) => row.contype === "p")?.columns.join(",") ?? "",
      uniques: rows
        .filter((row) => row.contype === "u")
        .map((row) => row.columns.join(","))
        .sort(),
      indexes: indexes.rows
        .map((row) => `${row.name}${row.unique ? " unique" : ""}${row.partial ? " partial" : ""}`)
        .sort(),
      foreignKeys: rows
        .filter((row) => row.contype === "f")
        .map(
          (row) =>
            `${row.columns.join(",")} -> ${row.foreign_table}(${row.foreign_columns?.join(",")}) on delete ${ON_DELETE[row.confdeltype]}`,
        )
        .sort(),
    };
  }

  beforeAll(async () => {
    pg = new PGlite();
    const migrations = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrations.length).toBeGreaterThan(0);
    for (const file of migrations) {
      await pg.exec(await readFile(new URL(file, migrationsDir), "utf8"));
    }
    await runSeed();
    db = drizzle({ client: pg, schema });
  });

  afterAll(async () => {
    await pg.close();
  });

  it("has exactly the Drizzle tables in schema public", async () => {
    expect(await publicTables()).toEqual(tableNames);
  });

  it.each(drizzleTables.map((table) => [getTableName(table), table] as const))(
    "%s columns match the SQL",
    async (name, table) => {
      expect(drizzleColumns(table)).toEqual(await sqlColumns(name));
    },
  );

  it.each(drizzleTables.map((table) => [getTableName(table), table] as const))(
    "%s keys, indexes and foreign keys match the SQL",
    async (name, table) => {
      expect(drizzleKeys(table)).toEqual(await sqlKeys(name));
    },
  );

  it("enables row level security on every public table", async () => {
    const { rows } = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    expect(rows).toHaveLength(tableNames.length);
    expect(rows.filter((row) => !row.relrowsecurity).map((row) => row.relname)).toEqual([]);
  });

  it("seeds the launch registry", async () => {
    const assets = await db.select().from(schema.assets);
    expect(assets).toHaveLength(17);

    const xStocks = assets.filter((asset) => asset.issuer === "xstocks");
    const preStocks = assets.filter((asset) => asset.issuer === "prestocks");
    expect(xStocks).toHaveLength(9);
    expect(preStocks).toHaveLength(8);
    for (const asset of xStocks) {
      expect(asset).toMatchObject({ decimals: 8, tokenProgram: TOKEN_2022, kind: "listed_equity" });
      expect(asset.feedId).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.schedule).toMatch(/^America\/New_York;/);
    }
    for (const asset of preStocks) {
      expect(asset).toMatchObject({ tokenProgram: TOKEN_2022, kind: "pre_ipo", feedId: null });
    }
  });

  it("re-running the seed leaves the registry unchanged", async () => {
    // #given
    const snapshot = () =>
      pg.query(
        `select to_jsonb(assets) - 'updated_at' as row from assets order by sort_order, mint`,
      );
    const before = await snapshot();

    // #when
    await runSeed();

    // #then
    const after = await snapshot();
    expect(after.rows).toHaveLength(17);
    expect(after.rows).toEqual(before.rows);
  });

  async function insertPaycheck(label: string) {
    const [router] = await db
      .insert(schema.routers)
      .values({
        owner: `test-owner-${label}`,
        routerPda: `test-router-pda-${label}`,
        authorityPda: `test-authority-pda-${label}`,
        payInAta: `test-pay-in-ata-${label}`,
        investBps: 2000,
        minInflow: 20_000_000n,
        dailyCap: 5_000_000_000n,
        maxWaitSecs: 259_200,
        autoConvert: true,
        recorder: `test-recorder-${label}`,
      })
      .returning();
    if (!router) throw new Error("router insert returned no row");
    const values = (copy: string) => ({
      routerId: router.id,
      seq: 0n,
      paycheckPda: `test-paycheck-pda-${label}-${copy}`,
      inflow: 100_000_000n,
      investTotal: 20_000_000n,
      recordedSig: `test-recorded-sig-${label}-${copy}`,
      recordedAt: new Date(),
      expiresAt: new Date(Date.now() + 259_200_000),
    });
    const [paycheck] = await db.insert(schema.paychecks).values(values("first")).returning();
    if (!paycheck) throw new Error("paycheck insert returned no row");
    return { paycheck, sameSeq: values("second") };
  }

  it("rejects a second paycheck with the same router and seq", async () => {
    // #given
    const { sameSeq } = await insertPaycheck("seq");

    // #when
    const insert = db.insert(schema.paychecks).values(sameSeq);

    // #then
    await expect(insert).rejects.toMatchObject({
      cause: { code: UNIQUE_VIOLATION, constraint: "paychecks_router_id_seq_key" },
    });
  });

  it("rejects a second leg with the same paycheck and idx", async () => {
    // #given
    const { paycheck } = await insertPaycheck("idx");
    const leg = {
      paycheckId: paycheck.id,
      idx: 0,
      assetMint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
      amountIn: 20_000_000n,
    };
    await db.insert(schema.legs).values(leg);

    // #when
    const insert = db.insert(schema.legs).values(leg);

    // #then
    await expect(insert).rejects.toMatchObject({
      cause: { code: UNIQUE_VIOLATION, constraint: "legs_paycheck_id_idx_key" },
    });
  });

  it("keeps audit_log append-only", async () => {
    // #given
    await db.insert(schema.auditLog).values({ actorType: "system", action: "test.append" });

    // #when / #then
    await expect(pg.exec("update audit_log set action = 'changed'")).rejects.toThrow(/append-only/);
    await expect(pg.exec("delete from audit_log")).rejects.toThrow(/append-only/);
    await expect(pg.exec("truncate audit_log")).rejects.toThrow(/append-only/);
  });
});
