import type { Project } from "./types";

export const ADHOC_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

/** This project is available to everyone; a null phase means Ad hoc within any project. */
export const ADHOC_PROJECT: Project = {
  id: ADHOC_PROJECT_ID,
  name: "Ad hoc",
  color: "#64748b",
  description: "Work outside a planned project.",
  isArchived: false,
  memberIds: [],
  isAdhoc: true,
};
