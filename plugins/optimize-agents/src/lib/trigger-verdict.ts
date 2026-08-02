export function isPassingTriggerRate(
  shouldTrigger: boolean,
  triggerRate: number
): boolean {
  return shouldTrigger ? triggerRate >= 0.5 : triggerRate === 0
}
