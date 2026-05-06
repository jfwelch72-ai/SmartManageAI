// Task #2426: this file was split into per-domain files under shared/schema/features/.
// Kept as a re-export shim so every existing `@shared/schema` and
// `@shared/schema/features` import keeps working unchanged.
// See shared/schema/features/index.ts for the bucketing rule and the per-domain map.
export * from "./features/index";
