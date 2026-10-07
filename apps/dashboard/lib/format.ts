const usd = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/** Signed USDT amount, e.g. "+12.40" / "−3.10". The sign carries polarity, not just color. */
export const formatPnl = (value: number): string => {
  if (Math.abs(value) < 0.005) {
    return "0.00";
  }

  return `${value > 0 ? "+" : "−"}${usd.format(Math.abs(value))}`;
};

export const formatUsd = (value: number): string => usd.format(value);

export const pnlTone = (value: number): string =>
  value > 0.005 ? "text-gain-text" : value < -0.005 ? "text-loss-text" : "text-text-2";

/** Prices keep enough precision for low-priced coins (0.01200) without noise on BTC. */
export const formatPrice = (value: number | string | undefined): string => {
  if (value === undefined || value === "") {
    return "—";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric === 0) {
    return numeric === 0 ? "0" : "—";
  }

  const magnitude = Math.floor(Math.log10(Math.abs(numeric)));
  const decimals = magnitude >= 3 ? 2 : Math.min(8, Math.max(2, 4 - magnitude));

  return numeric.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: decimals
  });
};

export const formatQty = (value: number | undefined): string =>
  value === undefined ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 6 });

export const formatPercent = (value: number, digits = 1): string => `${value.toFixed(digits)}%`;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const timeAgo = (iso: string | undefined): string => {
  if (!iso) {
    return "never";
  }

  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);

  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86_400), "day");
};

export const formatDateTime = (iso: string | undefined): string =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })
    : "—";

export const describeEntry = (entry?: {
  type: string;
  price?: number;
  minPrice?: number;
  maxPrice?: number;
}): string => {
  if (!entry) return "—";
  if (entry.type === "MARKET") return "Market";
  if (entry.type === "LIMIT") return formatPrice(entry.price);
  return `${formatPrice(entry.minPrice)} – ${formatPrice(entry.maxPrice)}`;
};

export const humanize = (value: string): string =>
  value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
