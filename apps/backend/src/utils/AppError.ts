export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(message: string, statusCode = 500, code = "APPLICATION_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}
