
import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { PoolClient } from "pg";

const testPool = process.env.TEST_DATABASE_URL
    ? new Pool({
          connectionString: process.env.TEST_DATABASE_URL,
          ssl: { rejectUnauthorized: false },
      })
    : null;

const TABLE = "transaction_retry_test_rows";

async function prepareTestTable() {
    if (!testPool) {
        throw new Error("TEST_DATABASE_URL is not configured");
    }

    await testPool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            id INTEGER PRIMARY KEY,
            value INTEGER NOT NULL DEFAULT 0,
            on_call BOOLEAN NOT NULL DEFAULT TRUE
        )
    `);

    await testPool.query(`TRUNCATE TABLE ${TABLE}`);

    await testPool.query(`
        INSERT INTO ${TABLE} (id, value, on_call)
        VALUES (1, 0, TRUE), (2, 0, TRUE)
    `);
}

function getErrorCode(error: unknown): string | undefined {
    if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
    ) {
        return error.code;
    }

    return undefined;
}

async function rollbackSafely(client: PoolClient) {
    try {
        await client.query("ROLLBACK");
    } catch {
        // The transaction may already have been rolled back.
    }
}

after(async () => {
    await testPool?.end();
});

test(
    "PostgreSQL generates a real deadlock error (40P01)",
    { skip: !testPool },
    async () => {
        await prepareTestTable();

        const clientA = await testPool!.connect();
        const clientB = await testPool!.connect();

        try {
            await clientA.query("BEGIN");
            await clientB.query("BEGIN");

            // A locks row 1.
            await clientA.query(
                `UPDATE ${TABLE} SET value = value + 1 WHERE id = 1`
            );

            // B locks row 2.
            await clientB.query(
                `UPDATE ${TABLE} SET value = value + 1 WHERE id = 2`
            );

            // A now waits for B's row 2.
            const updateA = clientA.query(
                `UPDATE ${TABLE} SET value = value + 1 WHERE id = 2`
            );

            // Give A time to acquire its lock wait.
            await new Promise((resolve) => setTimeout(resolve, 150));

            // B requests row 1, creating the circular dependency.
            const updateB = clientB.query(
                `UPDATE ${TABLE} SET value = value + 1 WHERE id = 1`
            );

            const results = await Promise.allSettled([updateA, updateB]);

            const rejected = results.filter(
                (result) => result.status === "rejected"
            );

            assert.equal(rejected.length, 1);
            assert.equal(
                getErrorCode(
                    (rejected[0] as PromiseRejectedResult).reason
                ),
                "40P01"
            );

            // Commit the surviving transaction and roll back the victim.
            if (results[0].status === "fulfilled") {
                await clientA.query("COMMIT");
                await rollbackSafely(clientB);
            } else {
                await clientB.query("COMMIT");
                await rollbackSafely(clientA);
            }
        } finally {
            await rollbackSafely(clientA);
            await rollbackSafely(clientB);
            clientA.release();
            clientB.release();
        }
    }
);

test(
    "PostgreSQL generates a real serialization failure (40001)",
    { skip: !testPool },
    async () => {
        await prepareTestTable();

        const clientA = await testPool!.connect();
        const clientB = await testPool!.connect();

        try {
            await clientA.query(
                "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE"
            );

            await clientB.query(
                "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE"
            );

            // Both transactions read the same initial state.
            await clientA.query(
                `SELECT COUNT(*) FROM ${TABLE} WHERE on_call = TRUE`
            );

            await clientB.query(
                `SELECT COUNT(*) FROM ${TABLE} WHERE on_call = TRUE`
            );

            // Each transaction updates a different row.
            await clientA.query(
                `UPDATE ${TABLE} SET on_call = FALSE WHERE id = 1`
            );

            await clientB.query(
                `UPDATE ${TABLE} SET on_call = FALSE WHERE id = 2`
            );

            // Try to commit both transactions.
            const results = await Promise.allSettled([
                clientA.query("COMMIT"),
                clientB.query("COMMIT"),
            ]);

            const rejected = results.filter(
                (result) => result.status === "rejected"
            );

            assert.equal(rejected.length, 1);
            assert.equal(
                getErrorCode(
                    (rejected[0] as PromiseRejectedResult).reason
                ),
                "40001"
            );

            // PostgreSQL aborts the failed transaction automatically.
            await rollbackSafely(clientA);
            await rollbackSafely(clientB);
        } finally {
            await rollbackSafely(clientA);
            await rollbackSafely(clientB);
            clientA.release();
            clientB.release();
        }
    }
);
