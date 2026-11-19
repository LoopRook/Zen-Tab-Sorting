// Zen Tab Sorting — remembered collapsed/expanded state, keyed by group id.
//
// Zen's session restore brings tab-groups back expanded, so we remember the
// collapsed ones in a pref. That pref used to hold group LABELS, which meant
// two groups with the same name shared one state: collapse one "Research" and
// every "Research" came back collapsed. Firefox keeps a tab group's id across
// restarts, so entries are now { id, label, collapsed }.
//
// Old label-only entries (plain strings in the pref) mean "collapsed" and
// still apply by name to any group that has no id entry of its own. At startup
// the groups they matched are rewritten in the id form and the label entry is
// dropped (see migrateLegacyEntries). A group without an id falls back to a
// label-keyed entry.
// Pure functions; the pref I/O lives in rules.mjs and browser-hooks.mjs.

// Ids of closed groups are never reported to us, so cap the list (oldest go).
export const MAX_COLLAPSED_ENTRIES = 500;

export const parseCollapsedEntries = (raw) => {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || "").trim() || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const item of parsed) {
    if (typeof item === "string" && item) {
      out.push({ id: null, label: item, collapsed: true });
    } else if (item && typeof item === "object" && typeof item.label === "string") {
      out.push({
        id: typeof item.id === "string" && item.id ? item.id : null,
        label: item.label,
        collapsed: item.collapsed !== false,
      });
    }
  }
  return out;
};

// A bare string means "collapsed by label" (the old format), so anything else
// (an id entry, or a label entry recorded as expanded) is written as an object.
export const serializeCollapsedEntries = (entries) =>
  JSON.stringify(entries.slice(-MAX_COLLAPSED_ENTRIES).map((e) =>
    (e.id || e.collapsed === false ? { id: e.id || null, label: e.label, collapsed: e.collapsed } : e.label)));

// The entries that belong to a group: its id entry, or, for a group with no
// id, every label entry with its name (all of them describe it).
const belongsTo = ({ id, label }) => (e) => (id ? e.id === id : !e.id && e.label === label);

// Should this group come back collapsed? Its own id entry decides when there
// is one; otherwise a label-only entry with the same name does.
export const isSavedCollapsed = (entries, { id, label }) => {
  const own = id ? entries.find((e) => e.id === id) : null;
  if (own) return own.collapsed;
  return Boolean(label) && entries.some((e) => !e.id && e.label === label && e.collapsed);
};

// Record a group's current state. Returns the new list, or null when nothing
// changed so the caller can skip the pref write. Label-only entries are left
// alone for id-bearing groups: they may still be needed by other groups of
// that name that have not been migrated yet.
export const updateCollapsedEntries = (entries, group, collapsed) => {
  if (!group?.id && !group?.label) return null;
  const mine = belongsTo(group);
  const own = entries.filter(mine);
  if (own.length === 1 && own[0].collapsed === collapsed) return null;
  const next = entries.filter((e) => !mine(e));
  // Expanded is the default after a restore, so an expanded group needs an
  // entry only when a label entry would otherwise collapse it. Otherwise the
  // entry is simply dropped, which keeps the list down to collapsed groups.
  if (!collapsed && !isSavedCollapsed(next, group)) return own.length ? next : null;
  next.push({ id: group.id || null, label: group.label || "", collapsed });
  return next;
};

// One-time move from label entries to id entries, run once restored groups
// exist. Every id-bearing group that a label entry covers gets its own entry
// with its current state; label entries that matched at least one such group
// are then removed. Labels with no live group (another window, a group closed
// since) are kept so they can still migrate later.
export const migrateLegacyEntries = (entries, groups) => {
  const legacy = entries.filter((e) => !e.id);
  if (legacy.length === 0) return null;
  const next = [...entries];
  const migrated = new Set();
  for (const group of groups) {
    if (!group?.id || !group.label) continue;
    if (!legacy.some((e) => e.label === group.label)) continue;
    migrated.add(group.label);
    if (next.some((e) => e.id === group.id)) continue;
    next.push({ id: group.id, label: group.label, collapsed: Boolean(group.collapsed) });
  }
  if (migrated.size === 0) return null;
  return next.filter((e) => e.id || !migrated.has(e.label));
};
