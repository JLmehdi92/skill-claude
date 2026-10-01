import type { Metadata } from "next";
import { Spending } from "@/components/spending";

export const metadata: Metadata = { title: "Dépenses | Higgsfield local" };

export default function Page() {
  return <Spending />;
}
