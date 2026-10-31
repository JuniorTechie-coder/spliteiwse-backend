import { Router } from "express";
import { createGroup, getUserGroups, addGroupMember, getGroupMembers, removeGroupMembers} from "../controllers/groupController.js"
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/", authMiddleware, createGroup);
router.get("/", authMiddleware, getUserGroups);
router.post("/:groupId/members", authMiddleware, addGroupMember);
router.get("/:groupId/members", authMiddleware, getGroupMembers);
router.delete("/:groupId/members/:memberId", authMiddleware, removeGroupMembers);
export default router;

