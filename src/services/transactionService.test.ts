
import test from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";

import { pool } from "../config/db.js";
import { withTransactionRetry } from "./transactionService.js";

function createFakeClient() {
    const queries: string[] = [];
    let releaseCount = 0;

    const client = {
        query: async (sql: string) => {
            queries.push(sql);
            return { rows: [], rowCount: 0 };
        },
        release: () => {
            releaseCount++;
        },
    };

    return {
        client: client as unknown as PoolClient,
        queries,
        get releaseCount() {
            return releaseCount;
        },
    };
}

function createPostgresError(code: string): Error {
    return Object.assign(new Error(`PostgreSQL error ${code}`), {
        code,
    });
}

test("commits successfully without retrying", async (t) => {
    const fake = createFakeClient();

    t.mock.method(pool, "connect", async () => fake.client);

    let attempts = 0;

    const result = await withTransactionRetry(async () => {
        attempts++;
        return "success";
    });

    assert.equal(result, "success");
    assert.equal(attempts, 1);
    assert.deepEqual(fake.queries, ["BEGIN", "COMMIT"]);
    assert.equal(fake.releaseCount, 1);
});

test("retries after a deadlock error (40P01)", async (t) => {
    const clients = [createFakeClient(), createFakeClient()];
    let connections = 0;

    t.mock.method(pool, "connect", async () => {
        return clients[connections++]!.client;
    });

    let attempts = 0;

    const result = await withTransactionRetry(async () => {
        attempts++;

        if (attempts === 1) {
            throw createPostgresError("40P01");
        }

        return "success";
    });

    assert.equal(result, "success");
    assert.equal(attempts, 2);
    assert.deepEqual(clients[0]!.queries, ["BEGIN", "ROLLBACK"]);
    assert.deepEqual(clients[1]!.queries, ["BEGIN", "COMMIT"]);
    assert.equal(clients[0]!.releaseCount, 1);
    assert.equal(clients[1]!.releaseCount, 1);
});

test("retries after a serialization failure (40001)", async (t) => {
    const clients = [createFakeClient(), createFakeClient()];
    let connections = 0;

    t.mock.method(pool, "connect", async () => {
        return clients[connections++]!.client;
    });

    let attempts = 0;

    const result = await withTransactionRetry(async () => {
        attempts++;

        if (attempts === 1) {
            throw createPostgresError("40001");
        }

        return "success";
    });

    assert.equal(result, "success");
    assert.equal(attempts, 2);
    assert.deepEqual(clients[0]!.queries, ["BEGIN", "ROLLBACK"]);
    assert.deepEqual(clients[1]!.queries, ["BEGIN", "COMMIT"]);
});

test("does not retry non-retryable errors", async (t) => {
    const fake = createFakeClient();

    t.mock.method(pool, "connect", async () => fake.client);

    let attempts = 0;

    await assert.rejects(
        withTransactionRetry(async () => {
            attempts++;
            throw createPostgresError("23505");
        }),
        { code: "23505" }
    );

    assert.equal(attempts, 1);
    assert.deepEqual(fake.queries, ["BEGIN", "ROLLBACK"]);
    assert.equal(fake.releaseCount, 1);
});

test("stops after the maximum number of retries", async (t) => {
    const clients = [
        createFakeClient(),
        createFakeClient(),
        createFakeClient(),
    ];

    let connections = 0;

    t.mock.method(pool, "connect", async () => {
        return clients[connections++]!.client;
    });

    let attempts = 0;

    await assert.rejects(
        withTransactionRetry(
            async () => {
                attempts++;
                throw createPostgresError("40P01");
            },
            2
        ),
        { code: "40P01" }
    );

    // 2 retries means 3 total attempts.
    assert.equal(attempts, 3);
    assert.equal(connections, 3);

    for (const fake of clients) {
        assert.deepEqual(fake.queries, ["BEGIN", "ROLLBACK"]);
        assert.equal(fake.releaseCount, 1);
    }
});

test("rejects an invalid maxRetries value", async () => {
    await assert.rejects(
        withTransactionRetry(async () => "success", -1),
        /maxRetries must be a non-negative integer/
    );
});
