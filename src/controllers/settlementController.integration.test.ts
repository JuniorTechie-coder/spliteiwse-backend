import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPool } from "../config/testDb.js";
import { recordSettlementWithPool } from "./expenseController.js";

let userId: number;
let toUserId: number;
let groupId: number;
let expenseId: number;

before(async () => {
    const uniqueId = randomUUID();

    const userResult = await testPool.query(
        `INSERT INTO users
            (username, email, hashed_password)
         VALUES ($1, $2, $3)
         RETURNING user_id`,
        [
            `settlement_user_${uniqueId}`,
            `settlement_user_${uniqueId}@example.com`,
            "test_password_hash",
        ]
    );
    userId = userResult.rows[0].user_id;

    const toUserResult = await testPool.query(
        `INSERT INTO users
            (username, email, hashed_password)
         VALUES ($1, $2, $3)
         RETURNING user_id`,
        [
            `settlement_to_user_${uniqueId}`,
            `settlement_to_user_${uniqueId}@example.com`,
            "test_password_hash",
        ]
    );
    toUserId = toUserResult.rows[0].user_id;

    const groupResult = await testPool.query(
        `INSERT INTO "group" (group_name, created_by_user_id)
         VALUES ($1, $2)
         RETURNING group_id`,
        [`Settlement Test Group ${uniqueId}`, userId]
    );
    groupId = groupResult.rows[0].group_id;

    await testPool.query(
        `INSERT INTO member_group
            (user_id, group_id, net_balance_paise, is_active)
         VALUES ($1, $2, 0, TRUE), ($3, $2, 0, TRUE)`,
        [userId, groupId, toUserId]
    );

    const expenseResult = await testPool.query(
        `INSERT INTO expenses
            (paid_by_user_id, group_id, total_amount_paise, description)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [toUserId, groupId, 15000, "Settlement test expense"]
    );
    expenseId = expenseResult.rows[0].id;

    await testPool.query(
        `INSERT INTO expense_splits
            (expense_id, user_id, amount_owed_paise)
         VALUES ($1, $2, $3)`,
        [expenseId, userId, 15000]
    );
});

//Request Helper Functions
function createMockRequest(
    idempotencyKey: string,
    amountPaise = 5000
) {
    return {
        params: { groupId: String(groupId) },
        user: { userId },
        body: {
            to_user_id: toUserId,
            amount_paise: amountPaise,
        },
        get(headerName: string) {
            return headerName.toLowerCase() === "idempotency-key"
                ? idempotencyKey
                : undefined;
        },
    } as any;
}

//Response helper function
function createMockResponse() {
    const res: any = {
        statusCode: 200,
        body: null,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(body: unknown) {
            this.body = body;
            return this;
        },
    };

    return res;
}

//Test 1
test("should record a settlement and save its idempotency response", async () => {
    const idempotencyKey = randomUUID();

    const req = createMockRequest(idempotencyKey);
    const res = createMockResponse();

    await recordSettlementWithPool(req, res, testPool);

    assert.equal(res.statusCode, 201);

    assert.equal(
        res.body.message,
        "Settlement recorded successfully"
    );

    const settlementResult = await testPool.query(
        `SELECT *
         FROM settlements
         WHERE group_id = $1`,
        [groupId]
    );

    assert.equal(settlementResult.rowCount, 1);

    const idempotencyResult = await testPool.query(
        `SELECT *
         FROM idempotency_keys
         WHERE user_id = $1
           AND operation = $2
           AND idempotency_key = $3`,
        [userId, "record_settlement", idempotencyKey]
    );

    assert.equal(idempotencyResult.rowCount, 1);
    assert.equal(idempotencyResult.rows[0].response_status, 201);
});

//Test 2 
test("should replay the original response for an existing idempotency key", async () => {
    const idempotencyKey = randomUUID();

    const req1 = createMockRequest(idempotencyKey);
    const res1 = createMockResponse();

    // First request
    await recordSettlementWithPool(req1, res1, testPool);

    assert.equal(res1.statusCode, 201);

    // Count settlements after first request
    const beforeReplay = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM settlements
         WHERE group_id = $1`,
        [groupId]
    );

    // Second request with the same key and payload
    const req2 = createMockRequest(idempotencyKey);
    const res2 = createMockResponse();

    await recordSettlementWithPool(req2, res2, testPool);

    assert.equal(res2.statusCode, 201);

    // Both responses should be identical
    assert.deepEqual(
        JSON.parse(JSON.stringify(res2.body)),
        JSON.parse(JSON.stringify(res1.body))
    );

    // Verify no additional settlement was inserted
    const afterReplay = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM settlements
         WHERE group_id = $1`,
        [groupId]
    );

    assert.equal(
        afterReplay.rows[0].count,
        beforeReplay.rows[0].count
    );
});

//Test 3
test("should return 409 when the same idempotency key is used with a different payload", async () => {
    const idempotencyKey = randomUUID();

    // First request: 5000 paise
    const req1 = createMockRequest(idempotencyKey, 5000);
    const res1 = createMockResponse();

    await recordSettlementWithPool(req1, res1, testPool);

    assert.equal(res1.statusCode, 201);

    // Count settlements after first request
    const beforeConflict = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM settlements
         WHERE group_id = $1`,
        [groupId]
    );

    // Second request: same key, different amount
    const req2 = createMockRequest(idempotencyKey, 7000);
    const res2 = createMockResponse();

    await recordSettlementWithPool(req2, res2, testPool);

    assert.equal(res2.statusCode, 409);

    assert.equal(
        res2.body.message,
        "Idempotency key already used with a different request"
    );

    // Verify no additional settlement was created
    const afterConflict = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM settlements
         WHERE group_id = $1`,
        [groupId]
    );

    assert.equal(
        afterConflict.rows[0].count,
        beforeConflict.rows[0].count
    );
});


//Test 4 
test("should handle concurrent duplicate settlement requests", async () => {
    // Add fresh debt for this test
    const expenseResult = await testPool.query(
        `INSERT INTO expenses
            (paid_by_user_id, group_id, total_amount_paise, description)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [toUserId, groupId, 10000, "Concurrent settlement test"]
    );

    await testPool.query(
        `INSERT INTO expense_splits
            (expense_id, user_id, amount_owed_paise)
         VALUES ($1, $2, $3)`,
        [expenseResult.rows[0].id, userId, 10000]
    );

    const idempotencyKey = randomUUID();

    const req1 = createMockRequest(idempotencyKey, 5000);
    const req2 = createMockRequest(idempotencyKey, 5000);

    const res1 = createMockResponse();
    const res2 = createMockResponse();

    // Count existing settlements
    const before = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM settlements
         WHERE group_id = $1`,
        [groupId]
    );

    // Execute both requests simultaneously
    await Promise.all([
        recordSettlementWithPool(req1, res1, testPool),
        recordSettlementWithPool(req2, res2, testPool),
    ]);

    // Both requests should succeed
    assert.equal(res1.statusCode, 201);
    assert.equal(res2.statusCode, 201);

    // Both responses should be identical
    assert.deepEqual(
        JSON.parse(JSON.stringify(res1.body)),
        JSON.parse(JSON.stringify(res2.body))
    );

    // Only one new settlement should exist
    const after = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM settlements
         WHERE group_id = $1`,
        [groupId]
    );

    assert.equal(
        after.rows[0].count,
        before.rows[0].count + 1
    );

    // Only one idempotency record should exist
    const idempotencyResult = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM idempotency_keys
         WHERE user_id = $1
           AND operation = $2
           AND idempotency_key = $3`,
        [userId, "record_settlement", idempotencyKey]
    );

    assert.equal(idempotencyResult.rows[0].count, 1);
});

//Test 5 
test("should rollback failed settlement and allow idempotency key reuse", async () => {
    const idempotencyKey = randomUUID();

    // Only 5000 paise of debt remains after previous tests.
    // First request attempts to settle 6000 paise.
    const req1 = createMockRequest(idempotencyKey, 6000);
    const res1 = createMockResponse();

    await recordSettlementWithPool(req1, res1, testPool);

    assert.equal(res1.statusCode, 400);

    // Failed transaction should not leave an idempotency record.
    const failedKeyResult = await testPool.query(
        `SELECT id
         FROM idempotency_keys
         WHERE user_id = $1
           AND operation = $2
           AND idempotency_key = $3`,
        [userId, "record_settlement", idempotencyKey]
    );

    assert.equal(failedKeyResult.rowCount, 0);

    // Retry using the same key with a valid amount.
    const req2 = createMockRequest(idempotencyKey, 5000);
    const res2 = createMockResponse();

    await recordSettlementWithPool(req2, res2, testPool);

    assert.equal(res2.statusCode, 201);

    assert.equal(res2.body.settlement.amount_paise, 5000);

    // The successful retry should now have one idempotency record.
    const successfulKeyResult = await testPool.query(
        `SELECT response_status
         FROM idempotency_keys
         WHERE user_id = $1
           AND operation = $2
           AND idempotency_key = $3`,
        [userId, "record_settlement", idempotencyKey]
    );

    assert.equal(successfulKeyResult.rowCount, 1);
    assert.equal(successfulKeyResult.rows[0].response_status, 201);
});

after(async () => {
    await testPool.query(
        `DELETE FROM settlements WHERE group_id = $1`,
        [groupId]
    );

    await testPool.query(
        `DELETE FROM idempotency_keys WHERE user_id = ANY($1::int[])`,
        [[userId, toUserId]]
    );

    await testPool.query(
        `DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)`,
        [groupId]
    );

    await testPool.query(
        `DELETE FROM expenses WHERE group_id = $1`,
        [groupId]
    );

    await testPool.query(
        `DELETE FROM member_group WHERE group_id = $1`,
        [groupId]
    );

    await testPool.query(
        `DELETE FROM "group" WHERE group_id = $1`,
        [groupId]
    );

    await testPool.query(
        `DELETE FROM users WHERE user_id = ANY($1::int[])`,
        [[userId, toUserId]]
    );

    await testPool.end();
});
