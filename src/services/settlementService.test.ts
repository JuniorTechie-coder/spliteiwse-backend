import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateSettlements } from "./settlementService.js";

//Test 1
test("settles balances between one creditor and two debtors", () => {
    const balances = [
        {user_id: 1, username: "A", net_balance_paise: 50000},
        {user_id: 2, username: "B", net_balance_paise: -20000},
        {user_id: 3, username: "C", net_balance_paise: -30000},
    ];

    const result = calculateSettlements(balances);

    assert.deepEqual(result, [
        {
            from_user_id: 2,
            from_username: "B",
            to_user_id: 1,
            to_username: "A",
            amount_paise: 20000,
        },
        {
            from_user_id: 3,
            from_username: "C",
            to_user_id: 1,
            to_username: "A",
            amount_paise: 30000,
        },
    ]

    );
});


//Test 2
test("settles equal and opposite balances in one payment", () => {
    const balances = [
        { user_id: 1, username: "A", net_balance_paise: 70000 },
        { user_id: 2, username: "B", net_balance_paise: -70000 },
    ];

    const result = calculateSettlements(balances);

    assert.deepEqual(result, [
        {
            from_user_id: 2,
            from_username:"B",
            to_user_id: 1,
            to_username:"A",
            amount_paise: 70000
        }
    ]);

});

//Test 3: Everyone has a zero balance
test("Test 3: Everyone has a zero balance", () => {
    const balances =[
        { user_id: 1, username: "A", net_balance_paise: 0 },
        { user_id: 2, username: "B", net_balance_paise: 0 },
    ];

    const result = calculateSettlements(balances);

    assert.deepEqual(result, []);
});



//Test 4: Empty input returns an empty array
test("returns an empty array when there are no members", () => {
    assert.deepEqual(calculateSettlements([]), []);
});


//Test 5: Reject invalid balances(multiple tests):
test("rejects a non-integer balance", () => {
    const balances = [
        { user_id: 1, username: "A", net_balance_paise: 100.5 },
        { user_id: 2, username: "B", net_balance_paise: -100.5 },
    ];

    assert.throws(
         () => calculateSettlements(balances),
         /Every net balance must be a safe integer/
    );
});


test("rejects the NaN and non-infinite balances", () => {
    for (const invalidBalance of [NaN, Infinity, -Infinity]) {
        const balances = [
            { user_id: 1, username: "A", net_balance_paise: invalidBalance },
        ];

        assert.throws(
            () => calculateSettlements(balances),
            /Every net balance must be a safe integer/
        );
    }
});



test("rejects integers outside the safe integer range", () => {
    const balances = [
        {
            user_id: 1,
            username: "A",
            net_balance_paise: Number.MAX_SAFE_INTEGER + 1,
        },
    ];

    assert.throws(
        () => calculateSettlements(balances),
        /Every net balance must be a safe integer/
    );
});


//Test 6: Reject invalid member information
test("rejects invalid user IDs", () => {
    for (const userId of [0, -1, 1.5, NaN, Infinity]) {
        const balances = [
            { user_id: userId, username: "A", net_balance_paise: 0 },
        ];

        assert.throws(
            () => calculateSettlements(balances),
            /Every member must have a positive safe user ID/
        );
    }
});

test("rejects empty or whitespace-only usernames", () => {
    for (const username of ["", "   ", "\t"]) {
        const balances = [
            { user_id: 1, username, net_balance_paise: 0 },
        ];

        assert.throws(
            () => calculateSettlements(balances),
            /Every member must have a positive safe user ID/
        );
    }
});

test("rejects duplicate user IDs", () => {
    const balances = [
        { user_id: 1, username: "A", net_balance_paise: 10000 },
        { user_id: 1, username: "A", net_balance_paise: -10000 },
    ];

    assert.throws(
        () => calculateSettlements(balances),
        /Duplicate user IDs are not allowed/
    );
});

//Test 7: Reject unbalanced input
test("rejects balances that do not sum to zero", () => {
    const balances = [
        { user_id: 1, username: "A", net_balance_paise: 50000 },
        { user_id: 2, username: "B", net_balance_paise: -20000 },
    ];

    assert.throws(
        () => calculateSettlements(balances),
        /Total net balance must equal zero/
    );
});

//Test 8: Verify financial correctness
test("never suggests self-payments or nonpositive payments", () => {
    const balances = [
        { user_id: 1, username: "A", net_balance_paise: 50000 },
        { user_id: 2, username: "B", net_balance_paise: -20000 },
        { user_id: 3, username: "C", net_balance_paise: -30000 },
    ];

    const result = calculateSettlements(balances);

    for (const settlement of result) {
        assert.notEqual(
            settlement.from_user_id,
            settlement.to_user_id
        );
        assert.ok(settlement.amount_paise > 0);
        assert.ok(Number.isSafeInteger(settlement.amount_paise));
    }
});

test("does not mutate the original balances", () => {
    const balances = [
        { user_id: 1, username: "A", net_balance_paise: 50000 },
        { user_id: 2, username: "B", net_balance_paise: -20000 },
        { user_id: 3, username: "C", net_balance_paise: -30000 },
    ];

    const originalBalances = structuredClone(balances);

    calculateSettlements(balances);

    assert.deepEqual(balances, originalBalances);
});

test("suggested payments equal the total amount creditors should receive", () => {
    const balances = [
        { user_id: 1, username: "A", net_balance_paise: 50000 },
        { user_id: 2, username: "B", net_balance_paise: -20000 },
        { user_id: 3, username: "C", net_balance_paise: -30000 },
    ];

    const result = calculateSettlements(balances);

    const totalReceivable = balances
        .filter((balance) => balance.net_balance_paise > 0)
        .reduce((sum, balance) => sum + balance.net_balance_paise, 0);

    const totalSuggested = result.reduce(
        (sum, settlement) => sum + settlement.amount_paise,
        0
    );

    assert.equal(totalSuggested, totalReceivable);
});