import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";
import type { LoginRequestBody, RegisterRequestBody } from "../types/auth.types.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Registration Logic
export async function registerUser(
    req: Request<{}, {}, RegisterRequestBody>,
    res: Response
) {
    try {
        const { username, email, password } = req.body;

        // 1. Validate required fields and types
        if (
            typeof username !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !username.trim() ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: "Username, email, and password are required.",
            });
        }

        const cleanUsername = username.trim();
        const cleanEmail = email.trim().toLowerCase();

        // 2. Validate email format
        if (!EMAIL_REGEX.test(cleanEmail)) {
            return res.status(400).json({
                message: "Please enter a valid email address.",
            });
        }

        // 3. Validate username length
        if (cleanUsername.length < 3 || cleanUsername.length > 50) {
            return res.status(400).json({
                message: "Username must be between 3 and 50 characters long.",
            });
        }

        // 4. Validate password length (before hitting the database)
        if (password.length < 8) {
            return res.status(400).json({
                message: "Password must be at least 8 characters long.",
            });
        }

        if (password.length > 72) {
            return res.status(400).json({
                message: "Password must not exceed 72 characters.",
            });
        }

        // 5. Check if username or email already exists
        const existingUser = await pool.query(
            `SELECT user_id
             FROM users
             WHERE username = $1 OR email = $2
             LIMIT 1`,
            [cleanUsername, cleanEmail]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                message: "Username or email already exists.",
            });
        }

        // 6. Hash the password
        const hashedPassword = await bcrypt.hash(password, 12);

        // 7. Insert the new user into the database
        const result = await pool.query(
            `INSERT INTO users (username, email, hashed_password)
             VALUES ($1, $2, $3)
             RETURNING user_id, username, email, created_at`,
            [cleanUsername, cleanEmail, hashedPassword]
        );

        // 8. Send success response
        return res.status(201).json({
            message: "User created successfully!",
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
                message: "A user with these details already exists.",
            });
        }
        return res.status(500).json({
            message: "An unexpected error occurred during registration.",
        });
    }
}

// Login Logic
export async function loginUser(
    req: Request<{}, {}, LoginRequestBody>,
    res: Response
) {
    try {
        const { email, password } = req.body;

        // 1. Validate required fields
        if (
            typeof email !== "string" ||
            !email.trim() ||
            typeof password !== "string" ||
            !password
        ) {
            return res.status(400).json({
                message: "Email and password are required.",
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        // 2. Validate email format
        if (!EMAIL_REGEX.test(cleanEmail)) {
            return res.status(400).json({
                message: "Please enter a valid email address.",
            });
        }

        // 3. Find user by email
        const existingEmail = await pool.query(
            `SELECT user_id, username, email, hashed_password
             FROM users
             WHERE email = $1
             LIMIT 1`,
            [cleanEmail]
        );

        if (existingEmail.rows.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password.",
            });
        }

        const user = existingEmail.rows[0];

        // 4. Compare password hash
        const passwordMatched = await bcrypt.compare(
            password,
            user.hashed_password
        );

        if (!passwordMatched) {
            return res.status(401).json({
                message: "Invalid email or password.",
            });
        }

        // 5. Retrieve and validate JWT secret
        const jwtSecret = process.env.JWT_ACCESS_SECRET;
        if (!jwtSecret) {
            throw new Error("JWT_ACCESS_SECRET is not configured");
        }

        // 6. Generate access token
        const accessToken = jwt.sign(
            { userId: user.user_id },
            jwtSecret,
            { expiresIn: "15m" }
        );

        // 7. Set cookie
        res.cookie("accessToken", accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: 15 * 60 * 1000,
        });

        // 8. Return success response with user profile
        return res.status(200).json({
            message: "Login successful",
            user: {
                userId: user.user_id,
                username: user.username,
                email: user.email,
            },
        });
    } catch (error) {
        console.error("Login Error:", error);
        return res.status(500).json({
            message: "An unexpected error occurred during login.",
        });
    }
}

// Logout Logic
export async function logoutUser(req: Request, res: Response) {
    res.clearCookie("accessToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
    });

    return res.status(200).json({
        message: "Logout successful!",
    });
}
