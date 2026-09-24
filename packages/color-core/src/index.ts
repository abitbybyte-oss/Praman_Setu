/** Colour measurement core (ARCHITECTURE §4, §6).
 *
 * Pure TypeScript with no React Native dependencies: it takes an RGBA buffer and
 * knows nothing about cameras, so every rule is unit-testable in Node.
 *
 * Phase 1 fills this in: srgb, lab, ciede2000, ccm (affine 3x4 fit), sampling,
 * quality and classify. Deliberately empty until then — the Phase 0 exit
 * criteria only covers hashing and signing.
 */

export const COLOR_CORE_PLACEHOLDER = true;
