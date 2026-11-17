import { setCustomExtension } from "@pierre/diffs/utils/getFiletypeFromFileName";

export const SAGE_X3_ALIASES = ["sage-x3", "x3", "4gl", "sage-x3-4gl", "adonix"] as const;

export function isSageX3Language(language: string): boolean {
  return SAGE_X3_ALIASES.some((alias) => alias === language);
}

for (const extension of ["src", "4gl", "adx", "x3"]) {
  setCustomExtension(extension, "sage-x3");
  setCustomExtension(extension.toUpperCase(), "sage-x3");
}
