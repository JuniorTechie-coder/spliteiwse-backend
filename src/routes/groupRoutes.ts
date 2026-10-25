import { Router } from "express";
import { createGroup, getUserGroups, addGroupMember} from "../controllers/groupController.js"
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/", authMiddleware, createGroup);
router.get("/", authMiddleware, getUserGroups);
router.post("/:groupId/members", authMiddleware, addGroupMember);

export default router;

