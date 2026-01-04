export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function fmtMoney(n: number): string {
  return Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}
