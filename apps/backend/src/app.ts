import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";

import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFoundHandler } from "./middlewares/notFoundHandler.js";
import { apiRouter } from "./routes/index.js";
import { logger } from "./utils/logger.js";

export const app = express();

app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    autoLogging: env.NODE_ENV !== "test"
  })
);

app.use(helmet());
app.use(
  cors({
    origin: env.DASHBOARD_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true
  })
);
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false
  })
);
// Compression buffers output, which would stall the live event stream.
app.use(
  compression({
    filter: (request, response) =>
      request.path !== "/api/events" && compression.filter(request, response)
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
