import { ZodError } from "zod";

export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? "Check the entered details." }, { status: 400 });
  const cause = error as { code?: string; cause?: { code?: string } };
  if (cause.code === "23505" || cause.cause?.code === "23505") return Response.json({ error: "A record with those details already exists." }, { status: 409 });
  if (cause.code === "23503" || cause.cause?.code === "23503") return Response.json({ error: "The selected record is no longer available." }, { status: 400 });
  console.error("KPI operation failed", error instanceof Error ? error.name : "Unknown error");
  return Response.json({ error: "The request could not be saved. Please try again." }, { status: 500 });
}
