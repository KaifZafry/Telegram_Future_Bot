import { EventEmitter } from "node:events";

export type DashboardEvent =
  | {
      type: "log";
      data: {
        level: string;
        category: string;
        message: string;
        metadata?: Record<string, unknown>;
        createdAt: string;
      };
    }
  | { type: "positions" }
  | { type: "settings" };

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

/** In-process fan-out of live updates to connected dashboards (SSE). */
export const eventBus = {
  publish(event: DashboardEvent): void {
    emitter.emit("event", event);
  },
  subscribe(listener: (event: DashboardEvent) => void): () => void {
    emitter.on("event", listener);
    return () => {
      emitter.off("event", listener);
    };
  }
};
