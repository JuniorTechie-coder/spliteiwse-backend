import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const jwtSecret = process.env.JWT_ACCESS_SECRET;

  if (!jwtSecret) {
    return res.status(500).json({
      message: "Authentication service is not configured",
    });
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authorization header is missing or invalid",
    });
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();

  if (!accessToken) {
    return res.status(401).json({
      message: "Access token is missing",
    });
  }

  try {
    const decodedToken = jwt.verify(accessToken, jwtSecret);

    if (
      typeof decodedToken === "string" ||
      typeof decodedToken.userId !== "number" ||
      !Number.isInteger(decodedToken.userId)
    ) {
      return res.status(401).json({
        message: "Invalid access token payload",
      });
    }

    req.user = { userId: decodedToken.userId };

    return next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired access token",
    });
  }
}