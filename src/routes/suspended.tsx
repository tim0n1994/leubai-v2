import { Suspense, type ComponentType } from "react";

export function suspended(Child: ComponentType) {
  return (
    <Suspense fallback={null}>
      <Child />
    </Suspense>
  );
}
