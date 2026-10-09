import {
  Ban,
  CheckCircle2,
  CircleDot,
  Clock,
  Hand,
  MessageSquare,
  Reply,
  ShieldAlert,
  Target,
  TriangleAlert,
  XCircle,
  Zap
} from "lucide-react";
import type { ReactNode } from "react";

import type { CloseReason, ExecutionStatus, Signal } from "@/lib/types";

import { Badge, type Tone } from "./ui";

const icon = (node: ReactNode) => <span aria-hidden className="[&>svg]:size-3">{node}</span>;

export const SignalStatusBadge = ({
  signal
}: {
  signal: Pick<Signal, "status" | "parseStatus" | "followUp">;
}) => {
  if (signal.followUp) {
    const labels = { CLOSE: "Close", CANCEL: "Cancel", BREAKEVEN: "SL to entry", MOVE_SL: "Move SL" };
    const acted = signal.followUp.executionIds.length > 0;
    return (
      <Badge tone={acted ? "accent" : "neutral"} icon={icon(<Reply />)}>
        Follow-up: {labels[signal.followUp.action]}
      </Badge>
    );
  }

  if (signal.parseStatus === "FAILED") {
    return <Badge icon={icon(<MessageSquare />)}>Not a signal</Badge>;
  }

  const map: Record<Signal["status"], [Tone, string, ReactNode]> = {
    RECEIVED: ["neutral", "Received", <Clock key="i" />],
    PARSED: ["neutral", "Parsed", <CircleDot key="i" />],
    VALIDATED: ["warn", "Awaiting approval", <Clock key="i" />],
    EXECUTING: ["accent", "Placing orders", <Zap key="i" />],
    EXECUTED: ["accent", "Traded", <Zap key="i" />],
    COMPLETED: ["neutral", "Completed", <CheckCircle2 key="i" />],
    REJECTED: ["warn", "Rejected", <Ban key="i" />],
    FAILED: ["loss", "Failed", <XCircle key="i" />]
  };
  const [tone, label, glyph] = map[signal.status];

  return (
    <Badge tone={tone} icon={icon(glyph)}>
      {label}
    </Badge>
  );
};

export const ExecutionStatusBadge = ({ status }: { status: ExecutionStatus }) => {
  const map: Record<ExecutionStatus, [Tone, string, ReactNode]> = {
    PENDING: ["neutral", "Pending", <Clock key="i" />],
    EXECUTING: ["warn", "Waiting for entry", <Clock key="i" />],
    OPEN: ["accent", "Open", <CircleDot key="i" />],
    PARTIALLY_CLOSED: ["gain", "TP hit", <Target key="i" />],
    CLOSED: ["neutral", "Closed", <CheckCircle2 key="i" />],
    CANCELLED: ["neutral", "Cancelled", <Ban key="i" />],
    FAILED: ["loss", "Failed", <XCircle key="i" />]
  };
  const [tone, label, glyph] = map[status];

  return (
    <Badge tone={tone} icon={icon(glyph)}>
      {label}
    </Badge>
  );
};

export const CloseReasonBadge = ({ reason }: { reason?: CloseReason }) => {
  if (!reason) return <span className="text-muted">—</span>;

  const map: Record<CloseReason, [Tone, string, ReactNode]> = {
    TAKE_PROFIT: ["gain", "Take profit", <Target key="i" />],
    STOP_LOSS: ["loss", "Stop loss", <ShieldAlert key="i" />],
    MANUAL: ["neutral", "Manual", <Hand key="i" />],
    LIQUIDATION: ["loss", "Liquidated", <TriangleAlert key="i" />],
    CANCELLED: ["neutral", "Cancelled", <Ban key="i" />],
    ERROR: ["loss", "Error", <XCircle key="i" />]
  };
  const [tone, label, glyph] = map[reason];

  return (
    <Badge tone={tone} icon={icon(glyph)}>
      {label}
    </Badge>
  );
};

export const EnvironmentBadge = ({ environment }: { environment: "TESTNET" | "LIVE" }) =>
  environment === "LIVE" ? (
    <Badge tone="loss" icon={icon(<TriangleAlert />)}>
      Live
    </Badge>
  ) : (
    <Badge tone="accent">Testnet</Badge>
  );
