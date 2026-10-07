import { SignalParserService } from "./signal-parser.service.js";
import type { SignalParserRepository } from "./signal-parser.types.js";

export const createSignalParserService = (
  repository?: SignalParserRepository
): SignalParserService => new SignalParserService(repository);
