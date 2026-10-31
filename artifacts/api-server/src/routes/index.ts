import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import materialsRouter from "./materials";
import quizzesRouter from "./quizzes";
import flashcardsRouter from "./flashcards";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(materialsRouter);
router.use(quizzesRouter);
router.use(flashcardsRouter);
router.use(dashboardRouter);

export default router;
