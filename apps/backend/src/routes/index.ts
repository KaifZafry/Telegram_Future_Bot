import { Router } from "express";
import rateLimit from "express-rate-limit";

import { login, logout, me } from "../controllers/authController.js";
import {
  getDailyStats,
  getLogs,
  getSummary,
  streamEvents
} from "../controllers/dashboardController.js";
import {
  closeAllPositions,
  closePosition,
  listPositions,
  listTradeHistory
} from "../controllers/positionController.js";
import {
  createAccount,
  createSource,
  deleteAccount,
  deleteSource,
  getAccountBalance,
  getSettings,
  listAccounts,
  listSources,
  listTelegramChats,
  updateAccount,
  updateSettings,
  updateSource
} from "../controllers/settingsController.js";
import {
  getSignal,
  listSignals,
  previewSignalText
} from "../controllers/signalController.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { healthRouter } from "./healthRoutes.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

apiRouter.post("/auth/login", loginLimiter, asyncHandler(login));
apiRouter.post("/auth/logout", logout);

const privateRouter = Router();
privateRouter.use(requireAuth);

privateRouter.get("/auth/me", asyncHandler(me));
privateRouter.get("/dashboard/summary", asyncHandler(getSummary));
privateRouter.get("/stats/daily", asyncHandler(getDailyStats));
privateRouter.get("/logs", asyncHandler(getLogs));
privateRouter.get("/events", streamEvents);

privateRouter.get("/signals", asyncHandler(listSignals));
privateRouter.get("/signals/:id", asyncHandler(getSignal));
privateRouter.post("/tools/preview", asyncHandler(previewSignalText));

privateRouter.get("/positions", asyncHandler(listPositions));
privateRouter.post("/positions/close-all", asyncHandler(closeAllPositions));
privateRouter.post("/positions/:id/close", asyncHandler(closePosition));
privateRouter.get("/trades", asyncHandler(listTradeHistory));

privateRouter.get("/settings", asyncHandler(getSettings));
privateRouter.put("/settings", asyncHandler(updateSettings));
privateRouter.get("/sources", asyncHandler(listSources));
privateRouter.post("/sources", asyncHandler(createSource));
privateRouter.patch("/sources/:id", asyncHandler(updateSource));
privateRouter.delete("/sources/:id", asyncHandler(deleteSource));
privateRouter.get("/telegram/chats", asyncHandler(listTelegramChats));
privateRouter.get("/accounts", asyncHandler(listAccounts));
privateRouter.post("/accounts", asyncHandler(createAccount));
privateRouter.patch("/accounts/:id", asyncHandler(updateAccount));
privateRouter.delete("/accounts/:id", asyncHandler(deleteAccount));
privateRouter.get("/accounts/:id/balance", asyncHandler(getAccountBalance));

apiRouter.use(privateRouter);
