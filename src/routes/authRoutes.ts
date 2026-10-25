import { Router } from "express";
import { loginUser, registerUser } from "../controllers/authController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Route: POST /api/auth/register
router.post("/register", registerUser);
// Route: POST /api/auth/login
router.post("/login", loginUser);

router.get("/me", authMiddleware, (req, res) => {
  return res.status(200).json({
    userId: req.user!.userId,
  });
});

export default router;
