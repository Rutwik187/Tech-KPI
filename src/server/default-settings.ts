import type { Settings } from "@/lib/types";
export const DEFAULT_SETTINGS: Settings = {
  timezone: "Asia/Kolkata", trackingStartDate: "2026-10-12", workingDays: [1, 2, 3, 4, 5],
  workdayStart: "10:00", workdayEnd: "19:00", defaultDevCapacityHours: 33, defaultLeadCapacityHours: 10,
  deliveryWeight: 80, bugWeight: 20, leadTeamWeight: 70, leadOwnWeight: 30,
  criticalTargetHours: 4, normalTargetHours: 18, bandOnTarget: 85, bandBelowTarget: 70,
};
