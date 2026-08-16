// TejuBoss grocery-specific admin terminology.
// The underlying EazyLife data model is deliberately preserved so both
// businesses continue to use the same products/inventory engine.

const FIELD_MAP = [
  ['_processor', 'Unit / Type', 'e.g. 1kg, bottle, sachet, piece'],
  ['_ram', 'Size / Weight', 'e.g. 500g, 1L, medium'],
  ['_rom', 'Pack / Variant', 'e.g. single, pack of 6, carton'],
  ['_color', 'Variant / Flavour', 'e.g. Original, Chocolate, Blue']
];

function updateLabel(row, suffix, label, placeholder) {
  const input = row.querySelector(`[id$="${suffix}"]`);
  if (!input) return;
  input.placeholder = placeholder;
  const wrapper = input.parentElement;
  if (!wrapper) return;
  let labelEl = wrapper.querySelector('[data-tejuboss-label]');
  if (!labelEl) {
    labelEl = document.createElement('label');
    labelEl.dataset.tejubossLabel = '1';
    labelEl.className = 'block text-[9px] font-black uppercase text-gray-400 mb-1';
    wrapper.insertBefore(labelEl, input);
  }
  labelEl.textContent = label;
}

function adaptVariantRow(row) {
  if (!row || row.dataset.groceryAdapted === '1') return;
  row.dataset.groceryAdapted = '1';
  FIELD_MAP.forEach(([suffix, label, placeholder]) => updateLabel(row, suffix, label, placeholder));
}

function adaptProductEditor(root = document) {
  root.querySelectorAll('.variant-row').forEach(adaptVariantRow);
  const wrap = root.querySelector('#variantRows')?.parentElement;
  if (wrap) {
    const heading = wrap.querySelector('h3');
    if (heading) heading.textContent = 'Product Variants / Sizes';
    const help = wrap.querySelector('p');
    if (help) help.textContent = 'Add each size, pack, flavour or selling variant customers can choose and buy.';
  }
  const upgradeSection = root.querySelector('#upgradeRows')?.parentElement?.parentElement;
  if (upgradeSection) upgradeSection.style.display = 'none';
  const name = root.querySelector('#pName');
  if (name) name.placeholder = 'Product name (e.g. Golden Penny Spaghetti)';
  const brand = root.querySelector('#pBrand');
  if (brand) brand.placeholder = 'Brand (e.g. Golden Penny)';
  const category = root.querySelector('#pCategory');
  if (category) category.placeholder = 'Category (e.g. Groceries)';
  const desc = root.querySelector('#pDesc');
  if (desc) desc.placeholder = 'Short product description';
}

function adaptAdminText(root = document) {
  const replacements = [
    ['Optional Upgrades (RAM/ROM add-ons)', 'Optional Add-ons'],
    ['RAM/ROM add-ons', 'Optional add-ons'],
    ['Color / RAM / storage / price', 'Size / pack / variant / price'],
    ['device can be upgraded', 'product has an optional add-on']
  ];
  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    let value = node.nodeValue;
    replacements.forEach(([from, to]) => { value = value.replaceAll(from, to); });
    node.nodeValue = value;
  });
}

function run() {
  adaptProductEditor(document);
  adaptAdminText(document);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
  new MutationObserver(mutations => {
    mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        adaptProductEditor(node);
        adaptAdminText(node);
      }
    }));
  }).observe(document.body, { childList: true, subtree: true });
}
