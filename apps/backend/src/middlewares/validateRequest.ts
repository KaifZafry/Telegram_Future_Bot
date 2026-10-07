import type { NextFunction, Request, Response } from "express";
import type { AnyZodObject, ZodEffects } from "zod";

type RequestSchema = AnyZodObject | ZodEffects<AnyZodObject>;

export const validateRequest =
  (schema: RequestSchema) =>
  (request: Request, _response: Response, next: NextFunction): void => {
    schema.parse({
      body: request.body as unknown,
      params: request.params as unknown,
      query: request.query as unknown
    });

    next();
  };
