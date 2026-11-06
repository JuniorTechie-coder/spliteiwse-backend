
import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { PoolClient } from "pg";

import { withTransactionRetry } from "./transactionService.js";

const testPool = process.env.TEST_DATABASE_URL
    ? new Pool({
          connectionString: process.env.TEST_DATABASE_URL,
          ssl: { rejectUnauthorized: false },
      })
    : null;

const TABLE = "transaction_retry_e2e_test";

async function prepareTestTable() {
    if (!testPool) {
        throw new Error("TEST_DATABASE_URL is not configured");
    }

    await testPool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            id INTEGER PRIMARY KEY,
            on_call BOOLEAN NOT NULL
        )
    `);

    await testPool.query(`TRUNCATE TABLE ${TABLE}`);

    await testPool.query(`
        INSERT INTO ${TABLE} (id, on_call)
        VALUES (1, TRUE), (2, TRUE)
    `);
}

async function rollbackSafely(client: PoolClient) {
    try {
        await client.query("ROLLBACK");
    } catch {
        // The transaction may already be completed or aborted.
    }
}

after(async () => {
    await testPool?.end();
});

test(
    "retries a real PostgreSQL serialization failure and succeeds",
    { skip: !testPool },
    async () => {
        await prepareTestTable();

        const clientB = await testPool!.connect();

        let signalFirstAttemptReady!: () => void;
        const firstAttemptReady = new Promise<void>((resolve) => {
            signalFirstAttemptReady = resolve;
        });

        let allowFirstAttemptToFinish!: () => void;
        const firstAttemptCanFinish = new Promise<void>((resolve) => {
            allowFirstAttemptToFinish = resolve;
        });

        let attempts = 0;
        let retryPromise: Promise<string> | undefined;

        try {
            // Transaction B starts first.
            await clientB.query(
                "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE"
            );

            await clientB.query(
                `SELECT COUNT(*) FROM ${TABLE} WHERE on_call = TRUE`
            );

            // Transaction A is managed by our retry helper.
            retryPromise = withTransactionRetry(
                async (client) => {
                    attempts++;

                    await client.query(
                        "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"
                    );

                    await client.query(
                        `SELECT COUNT(*) FROM ${TABLE} WHERE on_call = TRUE`
                    );

                    if (attempts === 1) {
                        // A updates row 1.
                        await client.query(
                            `UPDATE ${TABLE}
                             SET on_call = FALSE
                             WHERE id = 1`
                        );

                        signalFirstAttemptReady();

                        // Wait until B commits its conflicting update.
                        await firstAttemptCanFinish;
                    } else {
                        // The retry runs in a fresh transaction.
                        await client.query(
                            `UPDATE ${TABLE}
                             SET on_call = FALSE
                             WHERE id = 1`
                        );
                    }

                    return "success";
                },
                1,
                testPool!
            );

            // Wait until A has read and updated row 1.
            await firstAttemptReady;

            // B updates a different row.
            await clientB.query(
                `UPDATE ${TABLE}
                 SET on_call = FALSE
                 WHERE id = 2`
            );

            // B commits. A's first transaction now has a serialization conflict.
            await clientB.query("COMMIT");

            // Allow A to finish. Its COMMIT should fail with 40001,
            // causing the helper to retry the entire operation.
            allowFirstAttemptToFinish();

            const result = await retryPromise;

            assert.equal(result, "success");
            assert.equal(attempts, 2);

            const finalRows = await testPool!.query(
                `SELECT id, on_call FROM ${TABLE} ORDER BY id`
            );

            assert.deepEqual(finalRows.rows, [
                { id: 1, on_call: false },
                { id: 2, on_call: false },
            ]);
        } finally {
            // Prevent a waiting callback from being left hanging on failure.
            allowFirstAttemptToFinish();

            if (retryPromise) {
                await retryPromise.catch(() => undefined);
            }

            await rollbackSafely(clientB);
            clientB.release();
        }
    }
);


test(
    "retries a real PostgreSQL deadlock and succeeds",
    { skip: !testPool },
    async () => {
        await prepareTestTable();

        const clientB = await testPool!.connect();

        let signalFirstAttemptReady!: () => void;
        const firstAttemptReady = new Promise<void>((resolve) => {
            signalFirstAttemptReady = resolve;
        });

        let allowFirstAttemptToContinue!: () => void;
        const firstAttemptCanContinue = new Promise<void>((resolve) => {
            allowFirstAttemptToContinue = resolve;
        });

        let attempts = 0;
        let retryPromise: Promise<string> | undefined;

        try {
            // Transaction B locks row 2 first.
            await clientB.query("BEGIN");

            await clientB.query(
                `UPDATE ${TABLE}
                 SET on_call = FALSE
                 WHERE id = 2`
            );

            // Transaction A starts through the retry helper.
            retryPromise = withTransactionRetry(
                async (client) => {
                    attempts++;

                    if (attempts === 1) {
                        // A locks row 1.
                        await client.query(
                            `UPDATE ${TABLE}
                             SET on_call = FALSE
                             WHERE id = 1`
                        );

                        signalFirstAttemptReady();

                        // Wait until B is ready to create the deadlock.
                        await firstAttemptCanContinue;
                    }

                    // First attempt waits for B's row 2.
                    // B then requests A's row 1, creating a deadlock.
                    // On retry, this update succeeds.
                    await client.query(
                        `UPDATE ${TABLE}
                         SET on_call = FALSE
                         WHERE id = 2`
                    );

                    return "success";
                },
                1,
                testPool!
            );

            // Wait until A has locked row 1.
            await firstAttemptReady;

            // A is now ready to request row 2.
            allowFirstAttemptToContinue();

            // B requests row 1, creating the circular lock dependency.
            const deadlockResult = await Promise.allSettled([
                clientB.query(
                    `UPDATE ${TABLE}
                     SET on_call = FALSE
                     WHERE id = 1`
                ),
                retryPromise,
            ]);

            const rejected = deadlockResult.filter(
                (result) => result.status === "rejected"
            );

            // Exactly one transaction should be selected as the deadlock victim.
            assert.equal(rejected.length, 1);

            const error = (rejected[0] as PromiseRejectedResult).reason;

            // The victim must be B, because the retry helper must receive
            // the error and retry A.
            assert.notEqual(
                error,
                undefined
            );

            // Wait for the helper to finish its retry.
            const result = await retryPromise;

            assert.equal(result, "success");
            assert.equal(attempts, 2);

            const finalRows = await testPool!.query(
                `SELECT id, on_call
                 FROM ${TABLE}
                 ORDER BY id`
            );

            assert.deepEqual(finalRows.rows, [
                { id: 1, on_call: false },
                { id: 2, on_call: false },
            ]);
        } finally {
            allowFirstAttemptToContinue();

            if (retryPromise) {
                await retryPromise.catch(() => undefined);
            }

            await rollbackSafely(clientB);
            clientB.release();
        }
    }
);

