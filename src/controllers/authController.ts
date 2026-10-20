
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js"
import type { LoginRequestBody, RegisterRequestBody } from "../types/auth.types.js";

export async function registerUser(
    req: Request<{}, {}, RegisterRequestBody>,
    res: Response
) {
    try {
        const { username, email, password } = req.body;

        //throw new Error("Intentional registration error for testing");

        1. //Validate required fields
        if (typeof username !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !username.trim() ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json
                ({
                    message: "Username, email, and password are required.",
                });

        }

        const cleanUsername = username.trim();
        const cleanEmail = email.trim().toLowerCase();

        // 2. Check whether the username or email already exists
        const existingUser = await pool.query(
            `SELECT user_id
        FROM users
        WHERE username = $1 OR email = $2
        LIMIT 1`,
            [cleanUsername, cleanEmail]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                message: "Username or email already exist!"
            });
        }

        //More validations on password
        if (password.length < 8) {
            return res.status(400).json({
                message: "password length must be minimum 8 !"
            })
        }
        3.//hash the password
        const hashedPassword = await bcrypt.hash(password, 12);

        //4.Insert the new user
        const result = await pool.query(
            `INSERT INTO users(username, email, hashed_password)
        VALUES($1, $2, $3)
        RETURNING user_id, username, email, created_at`,
            [cleanUsername, cleanEmail, hashedPassword]
        );

        //5.Send the response
        return res.status(201).json({
            message: "User is created successfully!",
            user: result.rows[0],
        });
    } catch (error) {
        console.error("Registration error:", error);
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23505"
        ) {
            return res.status(409).json({
                error: "A user with these details already exists.",
            });
        }
        return res.status(500).json({
            message: " An unexpected error occurred during registration."
        });

    }
}

//Login Logic
export async function loginUser(
    req: Request<{}, {}, LoginRequestBody>,
    res: Response
) {
    try {
        const { email, password } = req.body;
        const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

        //Validate the fields
        if (
            typeof password !== "string" ||
            !password
        ) {
            return res.status(400).json({
                message: "Enter valid email and password!"
            })
        }

        const existingEmail = await pool.query(
            `SELECT user_id, email, hashed_password
                FROM users
                WHERE email = $1`,
            [cleanEmail]
        );

        if (existingEmail.rows.length === 0) {
            return res.status(401).json({
                message: "invalid email or password"
            });
        }

        const user = existingEmail.rows[0];


        const passwordMatched = await bcrypt.compare(
            password,
            user.hashed_password
        );

        if (!passwordMatched) {
            return res.status(401).json({
                message: "Invalid email or password",
            });

        }

        return res.status(200).json({
            message: " Login Successful",
            user: {
                user_id: user.user_id,
                email: user.email,
            },
        });
        // return res.status(200).json({
        //  message: "User found",
        //  user: existingEmail.rows[0],
        // });
    } catch (error) {
         console.error("Login Error: ", error); 
        return res.status(500).json({
            error: "An unexpected error occurred during login."
        });



    }

}



