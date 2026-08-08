// Zen Tab Sorting — sorting mode decisions.
//
// Keeps the click orchestrator from hard-coding the meaning of every mode.

export const SORTING_MODES = {
  RULES_FIRST: "rules-first",
  HYBRID: "hybrid",
  FULL_AI: "full-ai",
};

export const normalizeSortingMode = (mode) =>
  Object.values(SORTING_MODES).includes(mode) ? mode : SORTING_MODES.RULES_FIRST;

export const resolveEffectiveSortingMode = ({ aiEngine, preferredMode }) =>
  aiEngine === "off" ? SORTING_MODES.RULES_FIRST : normalizeSortingMode(preferredMode);

export const isFullAIMode = (mode) => normalizeSortingMode(mode) === SORTING_MODES.FULL_AI;

export const resolvePass2ApplyOptions = (mode) =>
  isFullAIMode(mode)
    ? {
        existingBehavior: "transient",
        newGroupBehavior: "transient",
        persistRules: false,
      }
    : {};

export const resolveSortingPlan = ({ mode, tabs = [], pass1 }) => {
  const resolvedMode = normalizeSortingMode(mode);
  const emptyByGroup = new Map();
  const unmatched = Array.isArray(pass1?.unmatched) ? pass1.unmatched : [];

  if (resolvedMode === SORTING_MODES.FULL_AI) {
    return {
      mode: resolvedMode,
      shouldApplyPass1: false,
      pass1ByGroup: emptyByGroup,
      tabsForAI: tabs,
      aiInputLabel: "ALL eligible tab(s)",
      freshLike: true,
    };
  }

  return {
    mode: resolvedMode,
    shouldApplyPass1: true,
    pass1ByGroup: pass1?.byGroup instanceof Map ? pass1.byGroup : emptyByGroup,
    tabsForAI: unmatched,
    aiInputLabel: "unmatched tab(s)",
    freshLike: false,
  };
};
