import type { Request, Response } from "express";
import { z } from "zod";

import { env } from "../config/env.js";
import { getUserId, SESSION_COOKIE } from "../middlewares/requireAuth.js";
import { UserModel } from "../models/index.js";
import {
  createSessionToken,
  SESSION_TTL_SECONDS,
  verifyPassword
} from "../services/authService.js";
import { runtime } from "../services/runtime.js";
import { AppError } from "../utils/AppError.js";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1)
});

const sessionCookie = (value: string, maxAgeSeconds: number): string =>
  [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(env.NODE_ENV === "production" ? ["Secure"] : [])
  ].join("; ");

export const login = async (request: Request, response: Response): Promise<void> => {
  const { email, password } = loginSchema.parse(request.body);
  const user = await UserModel.findOne({ email, isActive: true }).select("+passwordHash");

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  }

  response.setHeader(
    "Set-Cookie",
    sessionCookie(createSessionToken(user._id.toString(), runtime.authSecret), SESSION_TTL_SECONDS)
  );
  response.json({ success: true, data: { name: user.name, email: user.email } });
};

export const logout = (_request: Request, response: Response): void => {
  response.setHeader("Set-Cookie", sessionCookie("", 0));
  response.json({ success: true });
};

export const me = async (_request: Request, response: Response): Promise<void> => {
  const user = await UserModel.findById(getUserId(response)).lean();
  response.json({ success: true, data: { name: user?.name, email: user?.email } });
};
