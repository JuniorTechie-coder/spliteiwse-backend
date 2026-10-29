import { pool } from "../config/db.js";

export type GroupMemberBalance = {
    user_id: number;
    username: string;
    total_paid_paise: number;   
     total_owed_paise: number;
    net_balance_paise: number;
};

export async function fetchGroupBalances(
    groupId: number
): Promise<GroupMemberBalance[]> {

    //Balances fetch query
     const balanceResult = await pool.query(
`WITH payments AS (
    SELECT
        paid_by_user_id AS user_id,
        SUM(total_amount_paise) AS total_paid_paise
    FROM expenses
    WHERE group_id = $1
    GROUP BY paid_by_user_id
    ),
    
shares AS (
    SELECT
        es.user_id,
        SUM(es.amount_owed_paise) AS total_owed_paise
    FROM expense_splits AS es
    INNER JOIN expenses AS e
        ON e.id = es.expense_id
    WHERE e.group_id = $1
    GROUP BY es.user_id
)
    SELECT
        u.user_id,
        u.username,
        COALESCE(p.total_paid_paise, 0) AS total_paid_paise,
        COALESCE(s.total_owed_paise, 0) AS total_owed_paise,
        COALESCE(p.total_paid_paise, 0)
        - COALESCE(s.total_owed_paise, 0) AS net_balance_paise
    FROM member_group AS mg
    INNER JOIN users AS u
        ON u.user_id = mg.user_id
    LEFT JOIN payments AS p
        ON p.user_id = u.user_id
    LEFT JOIN shares AS s
        ON s.user_id = u.user_id
    WHERE mg.group_id = $1
    ORDER BY u.user_id`,
    [groupId]
    );

    const balances = balanceResult.rows.map((row): GroupMemberBalance => {
        const userId = Number(row.user_id);
        const totalPaidPaise = Number(row.total_paid_paise);
        const totalOwedPaise = Number(row.total_owed_paise);
        const netBalancePaise = Number(row.net_balance_paise);

        if (
            !Number.isSafeInteger(userId) ||
            userId <= 0 ||
            typeof row.username !== "string" ||
            row.username.trim().length === 0 ||
            !Number.isSafeInteger(totalPaidPaise) ||
            !Number.isSafeInteger(totalOwedPaise) ||
            !Number.isSafeInteger(netBalancePaise)
        ) {
            throw new Error("Invalid balance data returned from database");
        }

        return {
            user_id: userId,
            username: row.username,
            total_paid_paise: totalPaidPaise,
            total_owed_paise: totalOwedPaise,
            net_balance_paise: netBalancePaise,
        };
    });

    return balances;
}
