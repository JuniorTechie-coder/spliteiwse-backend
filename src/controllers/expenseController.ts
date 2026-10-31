import type { Request, Response } from "express";
import { pool } from "../config/db.js";
import { fetchGroupBalances } from "../services/balanceService.js";
import { calculateSettlements } from "../services/settlementService.js";
import {fetchBilateralDebt} from "../services/bilateralDebtService.js";

export async function createExpense(req: Request, res: Response) {
    //Read the group ID
    const rawGroupId = req.params.groupId;

    //1.Read the request body
    const {
        description,
        total_amount_paise,
        paid_by_user_id,
        participants,
    } = req.body;

    // 2. Validate group ID
    if (
        typeof rawGroupId !== "string" ||
        !/^[1-9]\d*$/.test(rawGroupId)
    ) {
        return res.status(400).json({
            message: "Invalid group ID",
        });
    }

    const groupId = Number(rawGroupId);

    if (!Number.isSafeInteger(groupId)) {
        return res.status(400).json({
            message: "Invalid group ID",
        });
    }

    // 3. Validate description
    if (
        typeof description !== "string" ||
        description.trim().length === 0
    ) {
        return res.status(400).json({
            message: "Description is required",
        });
    }

    // 4. Validate total amount
    if (
        !Number.isSafeInteger(total_amount_paise) ||
        total_amount_paise <= 0
    ) {
        return res.status(400).json({
            message: "Amount must be a positive integer in paise",
        });
    }

    // 5. Validate payer ID
    if (
        !Number.isSafeInteger(paid_by_user_id) ||
        paid_by_user_id <= 0
    ) {
        return res.status(400).json({
            message: "Invalid payer ID",
        });
    }

    // 6. Validate participants array
    if (
        !Array.isArray(participants) ||
        participants.length === 0
    ) {
        return res.status(400).json({
            message: "Participants must be a non-empty array",
        });
    }

    // Every participant must be a positive integer
    const hasInvalidParticipant = participants.some(
        (id: unknown) =>
            !Number.isSafeInteger(id) || (id as number) <= 0
    );

    //This rejects invalid values such as:
    if (hasInvalidParticipant) {
        return res.status(400).json({
            message: "Every participant ID must be a positive integer",
        });
    }

    // Reject duplicate participant IDs
    if (new Set(participants).size !== participants.length) {
        return res.status(400).json({
            message: "Duplicate participant IDs are not allowed",
        });
    }

    // 6. Get authenticated user from JWT middleware
    const requesterId = req.user?.userId;

    if (!requesterId) {
        return res.status(401).json({
            message: "Authentication required",
        });
    }

    //Start a database transaction
    const client = await pool.connect();

    try {
        // 7. Begin transaction
        await client.query("BEGIN");

        // 8. Check whether group exists
        const groupResult = await client.query(
            `SELECT 1
             FROM "group"
             WHERE group_id = $1`,
            [groupId]
        );

        if (groupResult.rowCount === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Group not found",
            });
        }

        // 9. Check whether requester belongs to group
        const requesterMembership = await client.query(
            `SELECT 1
             FROM member_group
             WHERE user_id = $1
               AND group_id = $2`,
            [requesterId, groupId]
        );

        if (requesterMembership.rowCount === 0) {
            await client.query("ROLLBACK");

            return res.status(403).json({
                message: "You are not a member of this group",
            });
        }

        // 10. Check payer and all participants belong to group
        const requiredUserIds = [
            ...new Set([paid_by_user_id, ...participants]),
        ];

        //This checks which users belongs to tha group 
        const membershipResult = await client.query(
            `SELECT user_id
             FROM member_group
             WHERE group_id = $1
               AND user_id = ANY($2::int[])`,
            [groupId, requiredUserIds]
        );

        //this creates the unique users with id 
        const validMemberIds = new Set(
            membershipResult.rows.map(
                (row: { user_id: number }) => row.user_id
            )
        );

        const invalidMembers = requiredUserIds.filter(
            (id) => !validMemberIds.has(id)
        );

        if (invalidMembers.length > 0) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                message: "Payer and participants must belong to this group",
            });
        }

        // 11. Calculate equal splits, including any remainder
        const baseShare = Math.floor(
            total_amount_paise / participants.length
        );

        const remainder =
            total_amount_paise % participants.length;

        // 12. Insert the expense
        const expenseResult = await client.query(
            `INSERT INTO expenses
                (paid_by_user_id, group_id, total_amount_paise, description)
             VALUES ($1, $2, $3, $4)
             RETURNING id, paid_by_user_id, group_id,
                       total_amount_paise, description, created_at`,
            [
                paid_by_user_id,
                groupId,
                total_amount_paise,
                description.trim(),
            ]
        );

        const expense = expenseResult.rows[0];
        const splits = [];

        // 13. Insert each participant's share
        for (let i = 0; i < participants.length; i++) {
            const userId = participants[i];

            const share =
                baseShare + (i < remainder ? 1 : 0);

            const splitResult = await client.query(
                `INSERT INTO expense_splits
                    (expense_id, user_id, amount_owed_paise)
                 VALUES ($1, $2, $3)
                 RETURNING user_id, amount_owed_paise`,
                [expense.id, userId, share]
            );

            splits.push(splitResult.rows[0]);
        }

        // 14. Commit only after all inserts succeed
        await client.query("COMMIT");

        return res.status(201).json({
            message: "Expense created successfully",
            expense,
            splits,
        });
    } catch (error) {
        // Roll back the expense and any splits if something fails
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Expense rollback failed:", rollbackError);
        }

        console.error("Create expense error:", error);

        return res.status(500).json({
            message: "Failed to create expense",
        });
    } finally {
        // Return connection to the pool
        client.release();
    }
}


export async function getGroupExpenses(req: Request, res: Response) {
    const rawGroupId = req.params.groupId;

    if (
        typeof rawGroupId !== "string" ||
        !/^[1-9]\d*$/.test(rawGroupId)
    ) {
        return res.status(400).json({
            message: "Invalid group ID",
        });
    }

    const groupId = Number(rawGroupId);

    const userId = req.user?.userId;
    if (!userId) {
        return res.status(401).json({
            message: "Authentication is required!"
        });
    }

    try {
        //check group exist
        const existingGroupResult = await pool.query(
            `SELECT 1
             FROM "group"
             WHERE group_id = $1`,
            [groupId]
        );

        if (existingGroupResult.rows.length === 0) {
            return res.status(404).json({
                message: " This group does not exist!"
            });
        }

        //check Requester is a member
        const requesterMember = await pool.query(
            `SELECT 1
            FROM member_group
            WHERE group_id = $1
            AND user_id = $2`,
            [groupId, userId]
        );

        if (requesterMember.rows.length === 0) {
            return res.status(403).json({
                message: "User is not a member of this group!"
            });
        }

        //this query retrieve expenses and their payer:
        const expenseResult = await pool.query(
            `SELECT
               e.id,
               e.group_id,
               e.description,
               e.total_amount_paise,
               e.paid_by_user_id,
               payer.username AS payer_username,
               e.created_at
            FROM expenses AS e
            INNER JOIN users AS payer
               ON payer.user_id = e.paid_by_user_id
            WHERE e.group_id = $1
            ORDER BY e.created_at DESC`,
            [groupId]
        );

        const expenseIds = expenseResult.rows.map(
            (expense) => expense.id
        );

        if (expenseResult.rows.length === 0) {
            return res.status(200).json({
                expenses: [],
            });
        }

        // const expense = expenseResult.rows;
        // return res.status(200).json({
        //     expense,
        // })

        //second query retrieve all splits for the returned expenses in one query
        const splitResult = await pool.query(
            `SELECT 
           es.expense_id,
           es.user_id,
           u.username,
           es.amount_owed_paise
        FROM expense_splits AS es
        INNER JOIN users AS u
           ON u.user_id = es.user_id
        WHERE es.expense_id = ANY($1::int[])
        ORDER BY es.expense_id, es.user_id`,
            [expenseIds]
        );

        //attach the splits to their expenses
        const splitsByExpenseId = new Map<number, unknown[]>();

        for (const split of splitResult.rows) {
            const existingSplits =
                splitsByExpenseId.get(split.expense_id) ?? [];

            existingSplits.push(split);
            splitsByExpenseId.set(
                split.expense_id,
                existingSplits
            );
        }

        const expenses = expenseResult.rows.map((expense) => ({
            ...expense,
            splits: splitsByExpenseId.get(expense.id) ?? [],
        }));

        return res.status(200).json({
            expenses,
        });


    } catch (error) {
        console.error("Create expense error:", error);

        return res.status(500).json({
            message: "Failed to get expenses!",
        });

    }
}

export async function getGroupBalances(req: Request, res: Response) {
    const rawGroupId = req.params.groupId;

    if (
        typeof rawGroupId !== "string" ||
        !/^[1-9]\d*$/.test(rawGroupId)
    ) {
        return res.status(400).json({
            message: "Invalid group ID",
        });
    }

    const groupId = Number(rawGroupId);

    //Ensure groupId is a safe integer
    if (!Number.isSafeInteger(groupId)) {
    return res.status(400).json({
        message: "Invalid group ID",
    });
}

    const userId = req.user?.userId;
    if (!userId) {
        return res.status(401).json({
            message: "Authentication is required!"
        });
    }

    try {
        const groupExist = await pool.query(
            `SELECT 1
        FROM "group"
        WHERE group_id = $1`,
            [groupId]
        );

        if (groupExist.rows.length === 0) {
            return res.status(404).json({
                message: "This group does not exist!"
            });
        }

        const validGroupMember = await pool.query(
            `SELECT 1
         FROM member_group AS mg
         WHERE group_id = $1
         AND user_id = $2`,
            [groupId, userId]
        );

        if (validGroupMember.rows.length === 0) {
            return res.status(403).json({
                message: "user must be the member of the group!"
            });
        }

        const balances = await fetchGroupBalances(groupId);

        return res.status(200).json({
            balances,
        });
    } catch (error) {
    console.error("Fetch group balances error:", error);

    return res.status(500).json({
        message: "Failed to fetch group balances",
    });
}
}

export async function getSettlementSuggestions(req: Request, res: Response) {
 
    try{ 
        const rawGroupId = req.params.groupId;

   if (
        typeof rawGroupId !== "string" ||
        !/^[1-9]\d*$/.test(rawGroupId)
    ) {
        return res.status(400).json({
            message: "Invalid group ID",
        });
    }


    const groupId = Number(rawGroupId);

    if (!Number.isSafeInteger(groupId)) {
    return res.status(400).json({
        message: "Invalid group ID",
    });
}
    const userId = req.user?.userId;

    if(!userId){
        return res.status(401).json({
            message: "User is not authenticated",
        });
    }
     
     //check if group exist 
      const groupExist = await pool.query(
            `SELECT 1
        FROM "group"
        WHERE group_id = $1`,
            [groupId]
        );

        if (groupExist.rows.length === 0) {
            return res.status(404).json({
                message: "This group does not exist!"
            });
        }

        //check user belong to that group 
        const validGroupMember = await pool.query(
            `SELECT 1
         FROM member_group AS mg
         WHERE group_id = $1
         AND user_id = $2`,
            [groupId, userId]
        );

        if (validGroupMember.rows.length === 0) {
            return res.status(403).json({
                message: "user must be the member of the group!"
            });
        }


    const balances = await fetchGroupBalances(groupId);

    const settlements = calculateSettlements(
        balances.map((balance) => ({
          user_id: balance.user_id,
          username: balance.username,
          net_balance_paise: balance.net_balance_paise,
        }))
    );

    return res.status(200).json({
        settlements,
    });

}  catch (error) {
    console.error("Fetch settlement suggestions error:", error);

    return res.status(500).json({
        message: "Failed to calculate settlement suggestions",
    });
}
   

}

export async function recordSettlement(req: Request, res: Response){

    const rawGroupId = req.params.groupId;

    if(
        typeof rawGroupId !== "string" ||
         !/^[1-9]\d*$/.test(rawGroupId)
    ){
     return res.status(400).json({
        message: "Invalid group ID",
     });
    }
         const groupId = Number(rawGroupId);
    if(!Number.isSafeInteger(groupId)){
    return res.status(400).json({
        message: "Invalid group Id"
    });
    }

    const userId = req.user?.userId;
    if(!userId){
        return res.status(401).json({
            message: "User is not Authenticated!"
        });
    }

    const{ to_user_id, amount_paise } = req.body;

    if (
    !Number.isSafeInteger(to_user_id) ||
    to_user_id <= 0
) {
    return res.status(400).json({
        message: "to_user_id must be a positive safe integer",
    });
}

if (
    !Number.isSafeInteger(amount_paise) ||
    amount_paise <= 0
) {
    return res.status(400).json({
        message: "amount_paise must be a positive safe integer",
    });
}

//Reject paying yourself 
if (to_user_id === userId) {
    return res.status(400).json({
        message: "You cannot settle with yourself",
    });
}


const client = await pool.connect();
try{
   //start transaction
   await client.query("BEGIN");

    //group exist check 
 const groupExist = await client.query(
        `SELECT 1
         FROM "group"
         WHERE group_id = $1`,
        [groupId]
    );

    if (groupExist.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
            message: "Group does not exist",
        });
    }

    //Lock payer and recievers rows
     const lockMembers = await client.query(
        `SELECT user_id
        FROM member_group
        WHERE group_id = $1 
        AND user_id = ANY($2::int[])
        ORDER BY user_id
        FOR UPDATE`,
        [groupId, [userId, to_user_id]]
     )

     if(lockMembers.rowCount !== 2){
    await client.query("ROLLBACK");
    
       return res.status(403).json({
        message: "Both users must belong to the group",
    });
     }


    //payer belongs to this group validation
    const payerMembership = await client.query(
        `SELECT 1
         FROM member_group
         WHERE user_id = $1 
         AND group_id = $2`,
         [userId, groupId]
    )

    if(payerMembership.rows.length === 0){
    await client.query("ROLLBACK");

     return res.status(403).json({
        message: "Payer must be the member of the group!"
     })
    }


    //reciever belongs to this group validation
     const receiverMembership = await client.query(
        `SELECT 1
        FROM member_group
        WHERE user_id = $1
        AND group_id = $2`,
        [to_user_id, groupId]
     )

     if(receiverMembership.rows.length === 0){
        await client.query("ROLLBACK");

        return res.status(400).json({
            message: "Receiver must be the member of the group!"
        })
     }

     //calling the fetchBilateralDept service
     //Then this line recalculates the debt:
     const outstandingDebt = await fetchBilateralDebt(
    client,
    groupId,
    userId,
    to_user_id
);

//Validate amount
if(outstandingDebt <= 0){
    await client.query("ROLLBACK");

    return res.status(400).json({
        message: "No outstanding debt in this direction"
    });
}

if(amount_paise > outstandingDebt){
    await client.query("ROLLBACK");

    return res.status(400).json({
        message: "Payment exceeds outstanding debt"
    });
}

//Insert amount
const settlementResult = await client.query(
    `INSERT INTO settlements
        (group_id, from_user_id, to_user_id, amount_paise)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [groupId, userId, to_user_id, amount_paise]
);

await client.query("COMMIT");

return res.status(201).json({
    message: "Settlement recorded successfully",
    settlement: settlementResult.rows[0],
});


} catch (error) {
    try{
        await client.query("ROLLBACK");
    }catch(rollbackError){
        console.error("Rollback failed", rollbackError);
    }


    console.error("Record settlement error:", error);

    return res.status(500).json({
        message: "Failed to record settlement",
    });
} finally {
    client.release();
}  

}
