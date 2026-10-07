const EPSILON = 1e-9;

export const decimalsOf = (step: string): number => {
  const trimmed = step.includes(".") ? step.replace(/0+$/, "") : step;
  const dotIndex = trimmed.indexOf(".");
  return dotIndex < 0 ? 0 : trimmed.length - dotIndex - 1;
};

const toStep = (
  value: number,
  step: string,
  round: (units: number) => number
): string => {
  const stepValue = Number(step);
  const units = round(value / stepValue);
  return (units * stepValue).toFixed(decimalsOf(step));
};

export const floorToStep = (value: number, step: string): string =>
  toStep(value, step, (units) => Math.floor(units + EPSILON));

export const roundToStep = (value: number, step: string): string =>
  toStep(value, step, (units) => Math.round(units));

export const isZeroQuantity = (quantity: number, step: string): boolean =>
  Math.abs(quantity) < Number(step) / 2;
