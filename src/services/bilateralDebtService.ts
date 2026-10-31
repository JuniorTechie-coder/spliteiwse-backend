
import type { PoolClient } from "pg";

export async function fetchBilateralDebt(
     client: PoolClient,
    groupId: number,
    from_user_id: number,
    to_user_id: number
): Promise<number> {

    const bilateralResult = await client.query(
        `WITH expense_obligations AS (
    SELECT
        e.paid_by_user_id AS creditor_id,
        es.user_id AS debtor_id,
        SUM(es.amount_owed_paise) AS amount_paise
    FROM expenses AS e
    INNER JOIN expense_splits AS es
        ON es.expense_id = e.id
    WHERE e.group_id = $1
      AND es.user_id <> e.paid_by_user_id
    GROUP BY e.paid_by_user_id, es.user_id
)
SELECT
    COALESCE(
        SUM(amount_paise) FILTER (
            WHERE debtor_id = $2 AND creditor_id = $3
        ), 0
    )
    -
    COALESCE(
        SUM(amount_paise) FILTER (
            WHERE debtor_id = $3 AND creditor_id = $2
        ), 0
    )
    -
    COALESCE((
        SELECT SUM(amount_paise)
        FROM settlements
        WHERE group_id = $1
          AND from_user_id = $2
          AND to_user_id = $3
    ), 0)
    +
    COALESCE((
        SELECT SUM(amount_paise)
        FROM settlements
        WHERE group_id = $1
          AND from_user_id = $3
          AND to_user_id = $2
    ), 0)
    AS outstanding_debt_paise
FROM expense_obligations;`,
[groupId, from_user_id, to_user_id]
    )

    const row = bilateralResult.rows[0];

    if(!row){
        throw new Error("Bilateral debt result was not returned");
    }

    const outstandingdebtpaise = Number(row.outstanding_debt_paise);

    if(!Number.isSafeInteger(outstandingdebtpaise)){
        throw new Error(
            "Outstanding debt must be a safe integer"
        );
    }

    return outstandingdebtpaise;
}