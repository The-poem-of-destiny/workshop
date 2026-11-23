export function shouldSampleRequest(status: number, rate: number, random: number): boolean {
  if (status >= 500) return true;
  if (!Number.isFinite(rate) || rate <= 0) return false;
  return random < Math.min(1, rate);
}
