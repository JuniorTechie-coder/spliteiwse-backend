// expenseRoutes.ts
import { Router } from "express";
import { createExpense, getGroupExpenses } from "../controllers/expenseController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.post(
    "/groups/:groupId/expenses",
    authMiddleware,
    createExpense
);
router.get("/groups/:groupId/expenses", authMiddleware, getGroupExpenses);

export default router;