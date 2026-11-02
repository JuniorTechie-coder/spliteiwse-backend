import { Router } from "express";
import { loginUser, registerUser, logoutUser } from "../controllers/authController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Route: POST /api/auth/register
router.post("/register", registerUser);
// Route: POST /api/auth/login
router.post("/login", loginUser);
//GET  /api/auth/me
router.get("/me", authMiddleware, (req, res) => {
  return res.status(200).json({
    userId: req.user!.userId,
  });
});
//POST /api/auth/logout
router.post("/logout", logoutUser);

export default router;
