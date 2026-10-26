import type { Request, Response} from "express";
import { pool } from "../config/db.js";


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
       typeof rawGroupId !== "string"||
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
