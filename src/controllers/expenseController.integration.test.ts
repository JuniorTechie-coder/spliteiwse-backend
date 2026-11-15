import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { testPool } from "../config/testDb.js";
import { createExpenseWithPool } from "./expenseController.js";

function createMockResponse() {
    const res: any = {};

    res.status = (statusCode: number) => {
        res.statusCode = statusCode;
        return res;
    };

    res.json = (body: unknown) => {
        res.body = body;
        return res;
    };

    return res;
}

//Helper 
function createMockRequest(idempotencyKey: string, body: any) {
    return {
        params: {
            groupId: String(groupId),
        },
        user: {
            userId,
        },
        get: (headerName: string) => {
            if (headerName.toLowerCase() === "idempotency-key") {
                return idempotencyKey;
            }
            return undefined;
        },
        body,
    };
}

//describe block
describe("createExpense controller integration", () => {
    it("should create an expense and store its idempotency response", async () => {
        const idempotencyKey = randomUUID();

       const req: any = {
    params: {
        groupId: String(groupId),
    },
    user: {
        userId,
    },
    get: (headerName: string) => {
        if (headerName.toLowerCase() === "idempotency-key") {
            return idempotencyKey;
        }

        return undefined;
    },
    body: {
        description: "Dinner",
        total_amount_paise: 10000,
        paid_by_user_id: userId,
        participants: [userId],
    },
};

        const res = createMockResponse();

        await createExpenseWithPool(req, res, testPool);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.expense.total_amount_paise, 10000);

        const expenseResult = await testPool.query(
            `SELECT id, total_amount_paise, description
             FROM expenses
             WHERE id = $1`,
            [res.body.expense.id]
        );

        assert.equal(expenseResult.rowCount, 1);
        assert.equal(expenseResult.rows[0].total_amount_paise, 10000);
        assert.equal(expenseResult.rows[0].description, "Dinner");

        const splitResult = await testPool.query(
            `SELECT user_id, amount_owed_paise
             FROM expense_splits
             WHERE expense_id = $1`,
            [expenseResult.rows[0].id]
        );

        assert.equal(splitResult.rowCount, 1);
        assert.equal(splitResult.rows[0].user_id, userId);
        assert.equal(splitResult.rows[0].amount_owed_paise, 10000);

        const idempotencyResult = await testPool.query(
            `SELECT response_status, response_body
             FROM idempotency_keys
             WHERE user_id = $1
               AND operation = $2
               AND idempotency_key = $3`,
            [userId, "create_expense", idempotencyKey]
        );

        assert.equal(idempotencyResult.rowCount, 1);
        assert.equal(idempotencyResult.rows[0].response_status, 201);
        assert.deepEqual(
            idempotencyResult.rows[0].response_body,
            JSON.parse(JSON.stringify(res.body))
        );

    });

    it("should replay the original response without creating a duplicate expense", async () => {
    const idempotencyKey = randomUUID();

    const req: any = {
        params: {
            groupId: String(groupId),
        },
        user: {
            userId,
        },
        get: (headerName: string) => {
            if (headerName.toLowerCase() === "idempotency-key") {
                return idempotencyKey;
            }
            return undefined;
        },
        body: {
            description: "Movie Night",
            total_amount_paise: 15000,
            paid_by_user_id: userId,
            participants: [userId],
        },
    };

    // First request
    const firstRes = createMockResponse();

    await createExpenseWithPool(req, firstRes, testPool);

    // Second request: same payload and same key
    const secondRes = createMockResponse();

    await createExpenseWithPool(req, secondRes, testPool);

    // Both responses should represent the same result
    assert.equal(firstRes.statusCode, 201);
    assert.equal(secondRes.statusCode, 201);

    assert.deepEqual(
        secondRes.body,
        JSON.parse(JSON.stringify(firstRes.body))
    );

    // Verify only one expense was created
    const expenseId = firstRes.body.expense.id;

    const result = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM expenses
         WHERE id = $1`,
        [expenseId]
    );

    assert.equal(result.rows[0].count, 1);
});

});

let userId: number;
let groupId: number;

before(async () => {
    const uniqueId = randomUUID();

    const userResult = await testPool.query(
        `INSERT INTO users
            (username, email, hashed_password)
         VALUES ($1, $2, $3)
         RETURNING user_id`,
        [
            `test_user_${uniqueId}`,
            `test_${uniqueId}@example.com`,
            "test_password_hash",
        ]
    );

    userId = userResult.rows[0].user_id;

    const groupResult = await testPool.query(
        `INSERT INTO "group" (group_name, created_by_user_id)
         VALUES ($1, $2)
         RETURNING group_id`,
        [`Test Group ${uniqueId}`, userId]
    );

    groupId = groupResult.rows[0].group_id;

    await testPool.query(
        `INSERT INTO member_group
            (user_id, group_id, net_balance_paise, is_active)
         VALUES ($1, $2, 0, TRUE)`,
        [userId, groupId]
    );
});

after(async () => {
await testPool.query(
    `DELETE FROM idempotency_keys WHERE user_id = $1`,
    [userId]
);

    await testPool.query(
        `DELETE FROM "group" WHERE group_id = $1`,
        [groupId]
    );

    await testPool.query(
        `DELETE FROM users WHERE user_id = $1`,
        [userId]
    );

    await testPool.end();
});


//Test
it("should create separate expenses when identical payloads use different keys", async () => {
    const body = {
        description: "Gym Membership",
        total_amount_paise: 50000,
        paid_by_user_id: userId,
        participants: [userId],
    };

    const firstRes = createMockResponse();
    const secondRes = createMockResponse();

    await createExpenseWithPool(
        createMockRequest(randomUUID(), body) as any,
        firstRes,
        testPool
    );

    await createExpenseWithPool(
        createMockRequest(randomUUID(), body) as any,
        secondRes,
        testPool
    );

    assert.equal(firstRes.statusCode, 201);
    assert.equal(secondRes.statusCode, 201);

    assert.notEqual(
        firstRes.body.expense.id,
        secondRes.body.expense.id
    );
});

//Test
it("should create only one expense for concurrent requests using the same key", async () => {
    const idempotencyKey = randomUUID();

    const body = {
        description: "Concurrent Dinner",
        total_amount_paise: 25000,
        paid_by_user_id: userId,
        participants: [userId],
    };

    const req1 = createMockRequest(idempotencyKey, body);
    const req2 = createMockRequest(idempotencyKey, body);

    const res1 = createMockResponse();
    const res2 = createMockResponse();

    await Promise.all([
        createExpenseWithPool(req1 as any, res1, testPool),
        createExpenseWithPool(req2 as any, res2, testPool),
    ]);

    assert.equal(res1.statusCode, 201);
    assert.equal(res2.statusCode, 201);

    assert.deepEqual(
        JSON.parse(JSON.stringify(res1.body)),
        JSON.parse(JSON.stringify(res2.body))
    );

    const result = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM expenses
         WHERE group_id = $1
           AND description = $2`,
        [groupId, "Concurrent Dinner"]
    );

    assert.equal(result.rows[0].count, 1);
});

//Test 
it("should rollback the idempotency claim when expense creation fails", async () => {
    const idempotencyKey = randomUUID();

    const req = createMockRequest(idempotencyKey, {
        description: "Invalid Expense",
        total_amount_paise: 10000,
        paid_by_user_id: userId,
        participants: [999999999],
    });

    const res = createMockResponse();

    await createExpenseWithPool(req as any, res, testPool);

    assert.equal(res.statusCode, 400);

    const result = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM idempotency_keys
         WHERE user_id = $1
           AND operation = $2
           AND idempotency_key = $3`,
        [userId, "create_expense", idempotencyKey]
    );

    assert.equal(result.rows[0].count, 0);
});

//Test
it("should allow reuse of an idempotency key after a failed request", async () => {
    const idempotencyKey = randomUUID();

    const body = {
        description: "Corrected Expense",
        total_amount_paise: 12000,
        paid_by_user_id: userId,
        participants: [999999999],
    };

    const req = createMockRequest(idempotencyKey, body);

    const failedRes = createMockResponse();

    await createExpenseWithPool(req as any, failedRes, testPool);

    assert.equal(failedRes.statusCode, 400);

    // Correct the invalid participant.
    body.participants = [userId];

    const successfulRes = createMockResponse();

    await createExpenseWithPool(req as any, successfulRes, testPool);

    assert.equal(successfulRes.statusCode, 201);
    assert.equal(
        successfulRes.body.expense.description,
        "Corrected Expense"
    );

    const result = await testPool.query(
        `SELECT COUNT(*)::int AS count
         FROM idempotency_keys
         WHERE user_id = $1
           AND operation = $2
           AND idempotency_key = $3`,
        [userId, "create_expense", idempotencyKey]
    );

    assert.equal(result.rows[0].count, 1);
});




