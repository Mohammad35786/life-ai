/** Shared plan color palette — used consistently across all plan displays. */
export const PLAN_COLORS = ["#1D9E75", "#F07057", "#9B87F5", "#5B9CF6", "#E8A843"];

export function getPlanColor(index: number): string {
  return PLAN_COLORS[index % PLAN_COLORS.length];
}

/** Returns a light tinted background for a plan color */
export function getPlanColorBg(hex: string, opacity = 0.09): string {
  return `${hex}${Math.round(opacity * 255).toString(16).padStart(2, "0")}`;
}
