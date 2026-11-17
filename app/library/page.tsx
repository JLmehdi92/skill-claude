import type { Metadata } from "next";
import { Library } from "@/components/library";

export const metadata: Metadata = { title: "Historique" };

export default function Page() {
  return <Library />;
}
