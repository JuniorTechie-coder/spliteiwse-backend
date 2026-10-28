// expenseRoutes.ts
import { Router } from "express";
import { createExpense, getGroupExpenses, getGroupBalances } from "../controllers/expenseController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.post(
    "/groups/:groupId/expenses",
    authMiddleware,
    createExpense
);
router.get("/groups/:groupId/expenses", authMiddleware, getGroupExpenses);
router.get("/groups/:groupId/balances", authMiddleware, getGroupBalances);

export default router;