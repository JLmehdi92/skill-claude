import type { Metadata } from "next";
import { Library } from "@/components/library";

export const metadata: Metadata = { title: "Historique | Higgsfield local" };

export default function Page() {
  return <Library />;
}
