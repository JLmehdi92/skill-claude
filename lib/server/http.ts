import "server-only";
import { NextResponse } from "next/server";

export const json = <T>(data: T, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ errors: [message] }, { status });

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
