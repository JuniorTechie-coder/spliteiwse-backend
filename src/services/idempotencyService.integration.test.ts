import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

import { testPool } from "../config/testDb.js";

import {
    claimIdempotencyKey,
    completeIdempotencyKey,
    createRequestHash,
} from "./idempotencyService.js";

test("should claim and complete an idempotency key in PostgreSQL", async () => {
    const client = await testPool.connect();

    try {
        await client.query("BEGIN");
    //temporary test user
        const userResult = await client.query(
    `INSERT INTO users (username, email, hashed_password)
     VALUES ($1, $2, $3)
     RETURNING user_id`,
    [
        "idempotency_test_user",
        `idempotency-test-${randomUUID()}@example.com`,
        "test-hashed-password",
    ]
);

const userId = userResult.rows[0].user_id;

        const requestHash = createRequestHash({
            groupId: 1,
            amount_paise: 5000,
        });

        const claim = await claimIdempotencyKey(client, {
            userId,
            operation: "create_expense",
            idempotencyKey: randomUUID(),
            requestHash,
        });

        assert.equal(claim.isReplay, false);

        if (claim.isReplay || "conflict" in claim) {
            throw new Error("Expected a new idempotency key");
        }

        const responseBody = {
            message: "Expense created successfully",
            expenseId: 100,
        };

        await completeIdempotencyKey(
            client,
            claim.id,
            201,
            responseBody
        );

        const result = await client.query(
            `SELECT response_status, response_body
             FROM idempotency_keys
             WHERE id = $1`,
            [claim.id]
        );

        assert.equal(result.rowCount, 1);
        assert.equal(result.rows[0].response_status, 201);
        assert.deepEqual(result.rows[0].response_body, responseBody);
    } finally {
        await client.query("ROLLBACK");
        client.release();
    }
});

//Test: replaying an existing request across separate transactions.
test("should replay the original response for an existing idempotency key", async () => {
    const client = await testPool.connect();
    const idempotencyKey = randomUUID();

    try {
        await client.query("BEGIN");

        const userResult = await client.query(
            `INSERT INTO users (username, email, hashed_password)
             VALUES ($1, $2, $3)
             RETURNING user_id`,
            [
                `idempotency_replay_user_${randomUUID()}`,
                `replay-${randomUUID()}@example.com`,
                "test-hashed-password",
            ]
        );

        const userId = userResult.rows[0].user_id;

        const requestHash = createRequestHash({
            groupId: 1,
            amount_paise: 5000,
        });

        const firstClaim = await claimIdempotencyKey(client, {
            userId,
            operation: "create_expense",
            idempotencyKey,
            requestHash,
        });

        if (firstClaim.isReplay || "conflict" in firstClaim) {
            throw new Error("Expected a new idempotency key");
        }

        const originalResponse = {
            message: "Expense created successfully",
            expenseId: 100,
        };

        await completeIdempotencyKey(
            client,
            firstClaim.id,
            201,
            originalResponse
        );

        await client.query("COMMIT");

        // Start a separate transaction to simulate a retry.
        await client.query("BEGIN");

        const replayResult = await claimIdempotencyKey(client, {
            userId,
            operation: "create_expense",
            idempotencyKey,
            requestHash,
        });

        assert.deepEqual(replayResult, {
            isReplay: true,
            response: {
                status: 201,
                body: originalResponse,
            },
        });
    } finally {
        await client.query("ROLLBACK");
        client.release();
    }
});



//Test: same key with a different request payload.
test("should detect conflict when the same key is used with a different payload", async () => {
    const client = await testPool.connect();
    const idempotencyKey = randomUUID();

    try {
        await client.query("BEGIN");

        const userResult = await client.query(
            `INSERT INTO users (username, email, hashed_password)
             VALUES ($1, $2, $3)
             RETURNING user_id`,
            [
                `idempotency_replay_user_${randomUUID()}`,
                `conflict-${randomUUID()}@example.com`,
                "test-hashed-password",
            ]
        );

        const userId = userResult.rows[0].user_id;

        const firstHash = createRequestHash({
            groupId: 1,
            amount_paise: 5000,
        });

        const firstClaim = await claimIdempotencyKey(client, {
            userId,
            operation: "create_expense",
            idempotencyKey,
            requestHash: firstHash,
        });

        if (firstClaim.isReplay || "conflict" in firstClaim) {
            throw new Error("Expected a new idempotency key");
        }

        await completeIdempotencyKey(
            client,
            firstClaim.id,
            201,
            { message: "Expense created successfully" }
        );

        await client.query("COMMIT");
        await client.query("BEGIN");

        const secondHash = createRequestHash({
            groupId: 1,
            amount_paise: 7000,
        });

        const secondClaim = await claimIdempotencyKey(client, {
            userId,
            operation: "create_expense",
            idempotencyKey,
            requestHash: secondHash,
        });

        assert.deepEqual(secondClaim, {
            isReplay: false,
            conflict: true,
        });
    } finally {
        await client.query("ROLLBACK");
        client.release();
    }
});

//Test: Idempotency rollback
test("should remove the idempotency record when the transaction rolls back", async () => {
    const client = await testPool.connect();
    const idempotencyKey = randomUUID();

    try {
        await client.query("BEGIN");

        const userResult = await client.query(
            `INSERT INTO users (username, email, hashed_password)
             VALUES ($1, $2, $3)
             RETURNING user_id`,
            [
                `rollback_user_${randomUUID()}`,
                `rollback-${randomUUID()}@example.com`,
                "test-hashed-password",
            ]
        );

        const userId = userResult.rows[0].user_id;

        const requestHash = createRequestHash({
            groupId: 1,
            amount_paise: 5000,
        });

        const claim = await claimIdempotencyKey(client, {
            userId,
            operation: "create_expense",
            idempotencyKey,
            requestHash,
        });

        assert.equal(claim.isReplay, false);

        if (claim.isReplay || "conflict" in claim) {
            throw new Error("Expected a new idempotency key");
        }

        await client.query("ROLLBACK");

        const result = await testPool.query(
            `SELECT id
             FROM idempotency_keys
             WHERE user_id = $1
               AND operation = $2
               AND idempotency_key = $3`,
            [userId, "create_expense", idempotencyKey]
        );

        assert.equal(result.rowCount, 0);
    } finally {
        client.release();
    }
});

//Concurrent idempotency test
test("concurrent requests with the same key should return one original response", async () => {
    const idempotencyKey = randomUUID();

    // Create a user that both connections can reference.
    const userResult = await testPool.query(
        `INSERT INTO users (username, email, hashed_password)
         VALUES ($1, $2, $3)
         RETURNING user_id`,
        [
            `concurrent_user_${randomUUID()}`,
            `concurrent-${randomUUID()}@example.com`,
            "test-hashed-password",
        ]
    );

    const userId = userResult.rows[0].user_id;

    const clientA = await testPool.connect();
    const clientB = await testPool.connect();

    const requestHash = createRequestHash({
        groupId: 1,
        amount_paise: 5000,
    });

    try {
        // Client A claims the key but keeps its transaction open.
        await clientA.query("BEGIN");

        const firstClaim = await claimIdempotencyKey(clientA, {
            userId,
            operation: "create_expense",
            idempotencyKey,
            requestHash,
        });

        assert.equal(firstClaim.isReplay, false);

        if (firstClaim.isReplay || "conflict" in firstClaim) {
            throw new Error("Expected client A to claim the key");
        }

        const originalResponse = {
            message: "Expense created successfully",
            expenseId: 100,
        };

        await completeIdempotencyKey(
            clientA,
            firstClaim.id,
            201,
            originalResponse
        );

        // Client B attempts to claim the same key.
        await clientB.query("BEGIN");

        const secondClaimPromise = claimIdempotencyKey(clientB, {
            userId,
            operation: "create_expense",
            idempotencyKey,
            requestHash,
        });

        // Verify that client B is waiting for client A's transaction.
        let isWaiting = false;
        const deadline = Date.now() + 5000;

        while (Date.now() < deadline) {
            const activity = await testPool.query(
                `SELECT pid
                 FROM pg_stat_activity
                 WHERE datname = current_database()
                   AND wait_event_type = 'Lock'
                   AND query ILIKE '%INSERT INTO idempotency_keys%'
                   AND pid <> pg_backend_pid()`
            );

            if (activity.rowCount && activity.rowCount > 0) {
                isWaiting = true;
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, 25));
        }

        assert.equal(isWaiting, true, "Client B should wait for client A");

        // Client A commits. Client B can now continue.
        await clientA.query("COMMIT");

        const secondClaim = await secondClaimPromise;

        assert.deepEqual(secondClaim, {
            isReplay: true,
            response: {
                status: 201,
                body: originalResponse,
            },
        });

        await clientB.query("COMMIT");

        // Verify that PostgreSQL contains only one record for this key.
        const storedRecord = await testPool.query(
            `SELECT id
             FROM idempotency_keys
             WHERE user_id = $1
               AND operation = $2
               AND idempotency_key = $3`,
            [userId, "create_expense", idempotencyKey]
        );

        assert.equal(storedRecord.rowCount, 1);
    } finally {
        await clientA.query("ROLLBACK").catch(() => {});
        await clientB.query("ROLLBACK").catch(() => {});

        clientA.release();
        clientB.release();

        await testPool.query(
            `DELETE FROM idempotency_keys
             WHERE user_id = $1 AND idempotency_key = $2`,
            [userId, idempotencyKey]
        );

        await testPool.query(
            `DELETE FROM users WHERE user_id = $1`,
            [userId]
        );
    }
});

//Add the different-key integration test
test("different idempotency keys should create independent records for the same payload", async () => {
    const client = await testPool.connect();

    try {
        await client.query("BEGIN");

        const userResult = await client.query(
            `INSERT INTO users (username, email, hashed_password)
             VALUES ($1, $2, $3)
             RETURNING user_id`,
            [
                `different_keys_${randomUUID()}`,
                `different-keys-${randomUUID()}@example.com`,
                "test-hashed-password",
            ]
        );

        const userId = userResult.rows[0].user_id;

        const requestHash = createRequestHash({
            groupId: 1,
            amount_paise: 5000,
        });

        const firstClaim = await claimIdempotencyKey(client, {
            userId,
            operation: "create_expense",
            idempotencyKey: randomUUID(),
            requestHash,
        });

        const secondClaim = await claimIdempotencyKey(client, {
            userId,
            operation: "create_expense",
            idempotencyKey: randomUUID(),
            requestHash,
        });

        assert.equal(firstClaim.isReplay, false);
        assert.equal(secondClaim.isReplay, false);

        if (
            firstClaim.isReplay || "conflict" in firstClaim ||
            secondClaim.isReplay || "conflict" in secondClaim
        ) {
            throw new Error("Expected two independent key claims");
        }

        assert.notEqual(firstClaim.id, secondClaim.id);

        const result = await client.query(
            `SELECT COUNT(*)::int AS total
             FROM idempotency_keys
             WHERE user_id = $1 AND operation = $2`,
            [userId, "create_expense"]
        );

        assert.equal(result.rows[0].total, 2);
    } finally {
        await client.query("ROLLBACK");
        client.release();
    }
});
