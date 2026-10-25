import type { Request, Response} from "express";
import { pool } from "../config/db.js";


export async function createGroup(req: Request, res: Response){
    const { group_name } = req.body;

    //Validate the group name
    if(typeof group_name !== "string" ||
     group_name.trim().length === 0
    ) {
       return res.status(400).json({
        message: "Group name is required",
       });
    }

    //Get the authenticated user's ID from the JWT middleware
    const userId = req.user?.userId;

    if(!userId){
        return res.status(401).json({
            message: "Authentication required",

        });

    }

    //Acquire one database connection for transaction 
    const client = await pool.connect();

    try{
        await client.query("BEGIN");

        //create the group 
        const groupResult = await client.query(
            `INSERT INTO "group" (group_name)
                VALUES ($1)
                RETURNING group_id, group_name, created_at`,
                [group_name.trim()]
  
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

    }catch(error) {
        await client.query("ROLLBACK");

        console.error("Create group error:", error);

        return res.status(500).json({
            message: "Falied to create group"
        });
    }finally{
        // Always release the connection back to the pool
        client.release();
    }    
}



export async function getUserGroups(req: Request, res: Response){
    const userId = req.user?.userId

    if(!userId){
        return res.status(401).json({
            message: "Authentication required!"
        });
    }


    const client = await pool.connect();
try{
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
   } catch(error){
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
            message: "Failed to add member",
        });
    }
}