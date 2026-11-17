import { registerCustomLanguage } from "@pierre/diffs";

import { SAGE_X3_ALIASES } from "./sageX3Language.js";

const loadGrammar = async () => {
  const { default: grammar } = await import("./syntax/sage-x3.tmLanguage.json");
  return { default: [grammar] };
};

for (const language of SAGE_X3_ALIASES) {
  registerCustomLanguage(language, loadGrammar);
}
