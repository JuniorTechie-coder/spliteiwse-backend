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

  const token = req.cookies?.accessToken;

  if (!token || typeof token !== "string") {
    return res.status(401).json({
      message: "Authentication Required",
    });
  }


  try {
    const decodedToken = jwt.verify(token, jwtSecret);

    if (
      typeof decodedToken === "string" ||
      typeof decodedToken.userId !== "number" ||
      !Number.isInteger(decodedToken.userId) ||
      decodedToken.userId <= 0
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