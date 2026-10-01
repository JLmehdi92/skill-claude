import { Suspense } from "react";
import { Studio } from "@/components/studio";

export default function Page() {
  return (
    <Suspense>
      <Studio />
    </Suspense>
  );
}
