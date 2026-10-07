export interface HealthResponse {
  success: true;
  service: "trading-engine";
  status: "healthy";
  telegram?: {
    enabled: boolean;
    running: boolean;
    mode: "bot" | "user";
  };
  timestamp: string;
}
