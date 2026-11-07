import test from "node:test";
import assert from "node:assert/strict";

import { testPool } from "../config/testDb.js";

test("should connect to the dedicated test database", async () => {
    const result = await testPool.query(`
        SELECT
            current_database() AS database_name,
            current_schema() AS schema_name
    `);

    assert.equal(result.rowCount, 1);

    console.log("Connected test database:", result.rows[0].database_name);
    console.log("Test schema:", result.rows[0].schema_name);
});

test("should contain the required application tables", async () => {
    const result = await testPool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
    `, [[
        "users",
        "group",
        "member_group",
        "expenses",
        "expense_splits",
        "settlements",
        "idempotency_keys",
    ]]);

    const existingTables = result.rows.map(
        (row: { table_name: string }) => row.table_name
    );

    const requiredTables = [
        "users",
        "group",
        "member_group",
        "expenses",
        "expense_splits",
        "settlements",
        "idempotency_keys",
    ];

    assert.deepEqual(
        [...existingTables].sort(),
        [...requiredTables].sort()
    );
});

test("idempotency response columns should allow NULL", async () => {
    const result = await testPool.query(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'idempotency_keys'
          AND column_name IN ('response_status', 'response_body')
    `);

    assert.equal(result.rowCount, 2);

    for (const column of result.rows) {
        assert.equal(column.is_nullable, "YES");
    }
});