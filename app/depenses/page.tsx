import type { Metadata } from "next";
import { Spending } from "@/components/spending";

export const metadata: Metadata = { title: "Dépenses" };

export default function Page() {
  return <Spending />;
}
