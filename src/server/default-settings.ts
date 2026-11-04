import type { Settings } from "@/lib/types";
export const DEFAULT_SETTINGS: Settings = {
  // Only the people an admin adds to a team can sign in to raise requests. An admin can also let a whole work email domain in, on Other teams.
  requestDomains: [],
  timezone: "Asia/Kolkata", trackingStartDate: "2026-10-12", workingDays: [1, 2, 3, 4, 5],
  workdayStart: "10:00", workdayEnd: "19:00", defaultDevCapacityHours: 33, defaultLeadCapacityHours: 10,
  deliveryWeight: 80, bugWeight: 20, leadTeamWeight: 70, leadOwnWeight: 30,
  criticalTargetHours: 4, normalTargetHours: 18, bandOnTarget: 85, bandBelowTarget: 70,
};
/** Saved settings from before a field existed get that field's default. */
export function withDefaults(saved: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...saved };
}
