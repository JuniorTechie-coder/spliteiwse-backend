
import test from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { claimIdempotencyKey } from "./idempotencyService.js";
import {
    completeIdempotencyKey,
} from "./idempotencyService.js";
import { createRequestHash } from "./idempotencyService.js";


test("createRequestHash should generate a SHA-256 hash", () => {
    const payload = {
        groupId: 1,
        requesterId: 10,
        description: "Dinner",
        total_amount_paise: 10000,
        paid_by_user_id: 10,
        participants: [10, 20],
    };

    const hash = createRequestHash(payload);

    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);
});

test("createRequestHash should generate the same hash for the same payload", () => {
    const payload = {
        groupId: 1,
        requesterId: 10,
        amount_paise: 5000,
    };

    const firstHash = createRequestHash(payload);
    const secondHash = createRequestHash(payload);

    assert.equal(firstHash, secondHash);
});

test("createRequestHash should generate different hashes for different payloads", () => {
    const firstPayload = {
        groupId: 1,
        amount_paise: 5000,
    };

    const secondPayload = {
        groupId: 1,
        amount_paise: 7000,
    };

    const firstHash = createRequestHash(firstPayload);
    const secondHash = createRequestHash(secondPayload);

    assert.notEqual(firstHash, secondHash);
});

//Helper Function
function createMockClient(queryHandler: (sql: string, params?: unknown[]) => Promise<any>) {
    const queries: string[] = [];

    const client = {
        query: async (sql: string, params?: unknown[]) => {
            queries.push(sql);
            return queryHandler(sql, params);
        },
    };

    return { client: client as unknown as PoolClient, queries };
}

//Test 
test("claimIdempotencyKey should claim a new key", async () => {
    const { client, queries } = createMockClient(async () => ({
        rows: [{ id: "123" }],
        rowCount: 1,
    }));

    const result = await claimIdempotencyKey(client, {
        userId: 10,
        operation: "create_expense",
        idempotencyKey: "test-key-123",
        requestHash: "abc123",
    });

    assert.deepEqual(result, {
        isReplay: false,
        id: "123",
    });

    assert.equal(queries.length, 1);
});

//Replay Test
test("claimIdempotencyKey should return the original response for the same key and payload", async () => {
    const { client, queries } = createMockClient(async (sql) => {
        if (sql.includes("INSERT INTO idempotency_keys")) {
            return {
                rows: [],
                rowCount: 0,
            };
        }

        if (sql.includes("SELECT id, request_hash")) {
            return {
                rows: [
                    {
                        id: "123",
                        request_hash: "abc123",
                        response_status: 201,
                        response_body: {
                            message: "Expense created successfully",
                            expense: {
                                id: 50,
                                total_amount_paise: 10000,
                            },
                        },
                    },
                ],
                rowCount: 1,
            };
        }

        throw new Error("Unexpected SQL query");
    });

    const result = await claimIdempotencyKey(client, {
        userId: 10,
        operation: "create_expense",
        idempotencyKey: "test-key-123",
        requestHash: "abc123",
    });

    assert.deepEqual(result, {
        isReplay: true,
        response: {
            status: 201,
            body: {
                message: "Expense created successfully",
                expense: {
                    id: 50,
                    total_amount_paise: 10000,
                },
            },
        },
    });

    assert.equal(queries.length, 2);
}); 

//Conflict Test 
test("claimIdempotencyKey should return conflict when the same key is used with a different payload", async () => {
    const { client, queries } = createMockClient(async (sql) => {
        if (sql.includes("INSERT INTO idempotency_keys")) {
            return {
                rows: [],
                rowCount: 0,
            };
        }

        if (sql.includes("SELECT id, request_hash")) {
            return {
                rows: [
                    {
                        id: "123",
                        request_hash: "abc123",
                        response_status: 201,
                        response_body: {
                            message: "Expense created successfully",
                        },
                    },
                ],
                rowCount: 1,
            };
        }

        throw new Error("Unexpected SQL query");
    });

    const result = await claimIdempotencyKey(client, {
        userId: 10,
        operation: "create_expense",
        idempotencyKey: "test-key-123",
        requestHash: "xyz789",
    });

    assert.deepEqual(result, {
        isReplay: false,
        conflict: true,
    });

    assert.equal(queries.length, 2);
});

//Test for missing idempotency record 
test("claimIdempotencyKey should throw when existing record cannot be retrieved", async () => {
    const { client, queries } = createMockClient(async () => ({
        rows: [],
        rowCount: 0,
    }));

    await assert.rejects(
        claimIdempotencyKey(client, {
            userId: 10,
            operation: "create_expense",
            idempotencyKey: "test-key-123",
            requestHash: "abc123",
        }),
        {
            message: "Idempotency record could not be retrieved",
        }
    );

    assert.equal(queries.length, 2);
});

//Test incomplete existing record
test("claimIdempotencyKey should throw when existing record has no completed response", async () => {
    const { client } = createMockClient(async (sql) => {
        if (sql.includes("INSERT INTO idempotency_keys")) {
            return {
                rows: [],
                rowCount: 0,
            };
        }

        return {
            rows: [
                {
                    id: "123",
                    request_hash: "abc123",
                    response_status: null,
                    response_body: null,
                },
            ],
            rowCount: 1,
        };
    });

    await assert.rejects(
        claimIdempotencyKey(client, {
            userId: 10,
            operation: "create_expense",
            idempotencyKey: "test-key-123",
            requestHash: "abc123",
        }),
        {
            message: "Idempotency record exists without a completed response",
        }
    );
});

//Test successful completion
test("completeIdempotencyKey should store the response successfully", async () => {
    const { client, queries } = createMockClient(async () => ({
        rows: [{ id: "123" }],
        rowCount: 1,
    }));

    const responseBody = {
        message: "Expense created successfully",
        expense: {
            id: 50,
            total_amount_paise: 10000,
        },
    };

    await assert.doesNotReject(
        completeIdempotencyKey(
            client,
            "123",
            201,
            responseBody
        )
    );

    assert.equal(queries.length, 1);
});


//Test failed completion
test("completeIdempotencyKey should throw when no record is updated", async () => {
    const { client } = createMockClient(async () => ({
        rows: [],
        rowCount: 0,
    }));

    await assert.rejects(
        completeIdempotencyKey(
            client,
            "123",
            201,
            { message: "Expense created successfully" }
        ),
        {
            message: "Failed to complete idempotency record",
        }
    );
});