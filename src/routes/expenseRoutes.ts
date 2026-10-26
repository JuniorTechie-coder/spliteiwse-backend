// expenseRoutes.ts
import { Router } from "express";
import { createExpense } from "../controllers/expenseController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.post(
    "/groups/:groupId/expenses",
    authMiddleware,
    createExpense
);

export default router;