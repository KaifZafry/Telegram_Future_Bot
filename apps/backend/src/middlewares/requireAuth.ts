import type { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";

import { UserModel } from "../models/index.js";
import { verifySessionToken } from "../services/authService.js";
import { runtime } from "../services/runtime.js";
import { AppError } from "../utils/AppError.js";

export const SESSION_COOKIE = "tfb_session";

export const readCookie = (request: Request, name: string): string | undefined =>
  request.headers.cookie
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];

export interface AuthenticatedLocals {
  userId: Types.ObjectId;
}

export const getUserId = (response: Response): Types.ObjectId =>
  (response.locals as AuthenticatedLocals).userId;

export const requireAuth = (request: Request, response: Response, next: NextFunction): void => {
  const token = readCookie(request, SESSION_COOKIE);
  const session = token ? verifySessionToken(decodeURIComponent(token), runtime.authSecret) : undefined;

  if (!session || !Types.ObjectId.isValid(session.sub)) {
    next(new AppError("Not signed in", 401, "UNAUTHENTICATED"));
    return;
  }

  UserModel.exists({ _id: session.sub, isActive: true })
    .then((user) => {
      if (!user) {
        next(new AppError("Not signed in", 401, "UNAUTHENTICATED"));
        return;
      }

      (response.locals as AuthenticatedLocals).userId = new Types.ObjectId(session.sub);
      next();
    })
    .catch(next);
};
