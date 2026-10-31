import type { Request, Response } from "express";
import { pool } from "../config/db.js";
import { fetchGroupBalances } from "../services/balanceService.js";


export async function createGroup(req: Request, res: Response) {
    const { group_name } = req.body;

    //Validate the group name
    if (typeof group_name !== "string" ||
        group_name.trim().length === 0
    ) {
        return res.status(400).json({
            message: "Group name is required",
        });
    }

    //Get the authenticated user's ID from the JWT middleware
    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({
            message: "Authentication required",

        });

    }

    const created_by_user_id = userId;

    //Acquire one database connection for transaction 
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        //create the group 
        const groupResult = await client.query(
            `INSERT INTO "group" (
              group_name,
              created_by_user_id
            )
               VALUES ($1, $2)
                RETURNING group_id, group_name, created_by_user_id;`,
            [group_name.trim(), created_by_user_id]

        );

        const group = groupResult.rows[0];

        //Add the creator as a member
        await client.query(
            `INSERT INTO member_group
            (user_id, group_id, net_balance_paise)
            VALUES ($1, $2, $3)`,
            [userId, group.group_id, 0]
        );

        //save both changes together
        await client.query("COMMIT");

        return res.status(201).json({
            message: "Group created Successfully",
            group,
        });

    } catch (error) {
        await client.query("ROLLBACK");

        console.error("Create group error:", error);

        return res.status(500).json({
            message: "Falied to create group"
        });
    } finally {
        // Always release the connection back to the pool
        client.release();
    }
}

export async function getUserGroups(req: Request, res: Response) {
    const userId = req.user?.userId

    if (!userId) {
        return res.status(401).json({
            message: "Authentication required!"
        });
    }


    const client = await pool.connect();
    try {
        await client.query("BEGIN");



        const groupResult = await client.query(
            ` SELECT 
    g.group_id, 
    g.group_name, 
    g.created_at
    FROM "group" AS g
    INNER JOIN member_group AS mg
       ON g.group_id = mg.group_id
    WHERE mg.user_id = $1
    ORDER BY g.created_at DESC`,
            [userId]
        );

        const finalGroup = groupResult.rows;

        await client.query("COMMIT");

        return res.status(200).json({
            message: "Groups fetched successfully",
            groups: finalGroup,
        })
    } catch (error) {
        await client.query("ROLLBACK");

        console.error("fetching groups error:", error);

        return res.status(500).json({
            error: "Falied to create group"
        });
    } finally {
        client.release();
    }
}

export async function addGroupMember(req: Request, res: Response) {
    const groupId = Number(req.params.groupId);

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
            message: "groupId must be a positive integer",
        });
    }

    const { email } = req.body;
    const cleanEmail =
        typeof email === "string"
            ? email.trim().toLowerCase()
            : "";

    if (!cleanEmail) {
        return res.status(400).json({
            message: "Enter a valid email",
        });
    }

    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({
            message: "Authentication required",
        });
    }

    try {
        const existingGroupResult = await pool.query(
            `SELECT group_id, group_name, created_at
             FROM "group"
             WHERE group_id = $1`,
            [groupId]
        );

        if (existingGroupResult.rows.length === 0) {
            return res.status(404).json({
                message: "Group not found",
            });
        }

        const requesterMembership = await pool.query(
            `SELECT 1
             FROM member_group
             WHERE group_id = $1
               AND user_id = $2`,
            [groupId, userId]
        );

        if (requesterMembership.rows.length === 0) {
            return res.status(403).json({
                message: "You do not belong to this group",
            });
        }

        const targetUserResult = await pool.query(
            `SELECT user_id, email
             FROM users
             WHERE email = $1`,
            [cleanEmail]
        );

        if (targetUserResult.rows.length === 0) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        const targetUserId = targetUserResult.rows[0].user_id;

        const memberResult = await pool.query(
            `INSERT INTO member_group
                (group_id, user_id, net_balance_paise)
             VALUES ($1, $2, $3)
             RETURNING user_id, group_id, net_balance_paise`,
            [groupId, targetUserId, 0]
        );

        return res.status(201).json({
            message: "Member added successfully",
            member: memberResult.rows[0],
        });
    } catch (error) {
        console.error("Add group member error:", error);

        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23505"
        ) {
            return res.status(409).json({
                message: "User is already a member of this group",
            });
        }

        return res.status(500).json({
            error: "Failed to add member",
        });
    }
}

export async function getGroupMembers(req: Request, res: Response) {
    const groupId = Number(req.params.groupId);

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
            message: "GroupId must be positive!"
        });
    }
    //Read the authenticated user's ID from req.user.
    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({
            message: "Authentication required",
        });
    }

    try {
        const groupExistResult = await pool.query(
            `SELECT 1
        FROM "group" 
        WHERE group_id = $1`,
            [groupId]
        );

        if (groupExistResult.rows.length === 0) {
            return res.status(404).json({
                message: " Group not found!"
            });
        }

        //check wheather the authenticated user belong to that group 
        const requesterMembership = await pool.query(
            `SELECT 1
             FROM member_group
             WHERE group_id = $1
               AND user_id = $2`,
            [groupId, userId]
        );

        if (!requesterMembership.rows.length) {
            return res.status(403).json({
                message: "User does not belong to this group!"
            });
        }

        //query to get users belonging to that group
        const memberGroupResult = await pool.query(
            `SELECT u.user_id, u.username, u.email
        FROM users AS u
        INNER JOIN member_group AS mg
        ON u.user_id = mg.user_id 
        WHERE mg.group_id = $1`,
            [groupId],
        );

        return res.status(200).json({
            message: "Fetched members successfully",
            members: memberGroupResult.rows
        })

    } catch (error) {
        console.error("Fetch group member error:", error);

        return res.status(500).json({
            error: "Failed to fetch members!"
        });
    }

}

export async function removeGroupMembers(req: Request, res: Response) {
//Authenticated member Id 
const rawGroupId = req.params.groupId;

if(typeof rawGroupId !== "string" ||
   !/^[1-9]\d*$/.test(rawGroupId)
) {
    return res.status(400).json({
        message: "Invalide group ID",
    });
}

const groupId = Number(rawGroupId);
if(!Number.isSafeInteger(groupId)){
    return res.status(400).json({
        message: "groupId must be of safe positive integer!",
    });
}

const requiredId = req.user?.userId;
if(!requiredId){
    return res.status(401).json({
        message: "Authentication Required",
    });
}

const client = await pool.connect();

try{
    await client.query("BEGIN");

    //Lock the group row and fetch its creator
    const groupResult = await client.query(
        `SELECT created_by_user_id
        FROM "group"
        WHERE group_id = $1
        FOR UPDATE`,
        [groupId]
    );

    if(groupResult.rowCount === 0){
        await client.query("ROLLBACK");

        return res.status(404).json({
            message: "Group not found",
        });
    }


    //check and extract target user 
    const rawMemberId = req.params.memberId;
    if(!rawMemberId){
        await client.query("ROLLBACK");

        return res.status(404).json({
            message: "target user not found",
        });
    }
    const targetMemberId = Number(rawMemberId);

    //check for safe targetMemberId integer
    if(!Number.isSafeInteger(targetMemberId) ||
targetMemberId <= 0
) {
        await client.query("ROLLBACK");

        return res.status(400).json({
            message: "Member ID must be a positive safe integer"
        })
    }



    const creatorId = groupResult.rows[0].created_by_user_id;

    //Existing group may not have a creator assigned 
    if(creatorId === null){
        await client.query("ROLLBACK");

        return res.status(500).json({
          message: "Group creator is not assigned",
        });
    }

    // Validate creator permission
    if(Number(creatorId) !== requiredId){
        await client.query("ROLLBACK");

        return res.status(403).json({
            message: "Only group creators can remove members!",
        });
    }

    //member removal logic
     //target user is an active member:
     const activeMember = await client.query(
        `select user_id
        FROM member_group
        WHERE group_id = $1 
         AND user_id = $2
         AND is_active = TRUE
         FOR UPDATE`,
        [groupId, targetMemberId]
     );

     if(activeMember.rowCount === 0){
        await client.query("ROLLBACK");

        return res.status(404).json({
            message: " Member not found in this group!"
        });
     }

     //user do exist in member group 
     const member = activeMember.rows[0];

     const balance = await fetchGroupBalances(groupId);


     const targetBalance = balance.find(
        (balance) => balance.user_id === targetMemberId
     );

     //Target member balance validations
     if (!targetBalance) {
    await client.query("ROLLBACK");

    return res.status(500).json({
        message: "Member balance could not be found",
    });
} 

     if(targetBalance?.net_balance_paise !== 0){
        await client.query("ROLLBACK");

        return res.status(409).json({
            message: "Member net_balance should be zero",
        });

        
     }

     //Actually deleting the member
     const removeMemberResult = await client.query(
    `UPDATE member_group
     SET is_active = FALSE
     WHERE group_id = $1
       AND user_id = $2
       AND is_active = TRUE
     RETURNING user_id`,
    [groupId, targetMemberId]
);

  //Verify the delete
if (removeMemberResult.rowCount !== 1) {
    await client.query("ROLLBACK");

    return res.status(409).json({
        message: "Unable to remove member",
    });
}

  //commit the transaction \
await client.query("COMMIT");

return res.status(200).json({
    message: "Member removed successfully",
    user_id: targetMemberId,
});


} catch(error) {
    try{
        await client.query("ROLLBACK");

    }catch(rollbackError){
        console.error("Rollback failed:", rollbackError);
    }

    console.error("Delete member error:", error);

    return res.status(500).json({
        message: "Failed to authorize member removal",
    });
}finally {
    client.release();
}





}