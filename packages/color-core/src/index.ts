/** Colour measurement core (ARCHITECTURE §4, §6).
 *
 * Pure TypeScript with no React Native dependencies: it takes an RGBA buffer and
 * knows nothing about cameras, so every rule is unit-testable in Node.
 * All thresholds are passed in from the signed Reference DB, never hard-coded
 * as policy here. */

export * from "./color";
export * from "./ciede2000";
export * from "./image";
export * from "./ccm";
export * from "./sampling";
export * from "./metrics";
export * from "./card";
export * from "./quality";
export * from "./classify";
