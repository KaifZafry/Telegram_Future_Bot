import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction
) => Promise<unknown> | void;

export const asyncHandler =
  (handler: AsyncRequestHandler): RequestHandler =>
  (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
