// Teju Boss grocery/general-merchandise admin polish.
// The underlying data model (Firestore field names: processor/ram/rom/color)
// is deliberately preserved so the same products/inventory engine keeps working
// unchanged — this file only adds small persistent field-name labels above each
// variant input, since the placeholder text alone disappears once typed into.

const FIELD_LABELS = [
  ['_color', 'Variant / Flavour'],
  ['_processor', 'Unit / Type'],
  ['_ram', 'Size / Weight'],
  ['_rom', 'Pack / Carton']
];

function addLabel(row, suffix, label) {
  const input = row.querySelector(`[id$="${suffix}"]`);
  if (!input) return;
  const wrapper = input.parentElement;
  if (!wrapper || wrapper.querySelector('[data-tejuboss-label]')) return;
  const labelEl = document.createElement('label');
  labelEl.dataset.tejubossLabel = '1';
  labelEl.className = 'block text-[9px] font-black uppercase text-gray-400 mb-1';
  labelEl.textContent = label;
  wrapper.insertBefore(labelEl, input);
}

function adaptVariantRow(row) {
  if (!row || row.dataset.groceryAdapted === '1') return;
  row.dataset.groceryAdapted = '1';
  FIELD_LABELS.forEach(([suffix, label]) => addLabel(row, suffix, label));
}

function run(root = document) {
  root.querySelectorAll('.variant-row').forEach(adaptVariantRow);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => run(), { once: true });
  else run();
  new MutationObserver(mutations => {
    mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) run(node);
    }));
  }).observe(document.body, { childList: true, subtree: true });
}
