// admin/js/admin-products.mjs
// Products tab: add/edit form (with variants + upgrades), product list,
// and Excel export/import. Split out of admin-app.mjs.

import { addProduct, updateProduct, deleteProduct } from '../../js/commerce-store.mjs';
import { escapeHtml, updateImagePreview } from './admin-shared.mjs';

let allProducts = [];
const selectedProductIds = new Set();

/* ---------------- FORM ---------------- */

const productForm = document.getElementById('productForm');
let variantRowCounter = 0;
let upgradeRowCounter = 0;

function variantRowHTML(rowId, v = {}) {
  return `
    <div class="variant-row bg-white border border-gray-200 rounded-xl p-3" data-row-id="${rowId}">
      <input type="hidden" id="v${rowId}_stableId" value="${escapeHtml(v.id || '')}">
      <div class="grid grid-cols-2 gap-2 mb-2">
        <input id="v${rowId}_color" placeholder="Option label (e.g. 500g, 1 litre, Carton)" value="${escapeHtml(v.color || '')}" class="p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs">
        <input id="v${rowId}_processor" placeholder="Unit / pack details (optional)" value="${escapeHtml(v.processor || '')}" class="p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs">
      </div>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <input id="v${rowId}_ram" placeholder="Size (optional)" value="${escapeHtml(v.ram || '')}" class="p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs">
        <input id="v${rowId}_rom" placeholder="Pack quantity (optional)" value="${escapeHtml(v.rom || '')}" class="p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs">
      </div>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <input id="v${rowId}_price" type="number" min="0" step="0.01" placeholder="Selling price (₦)" value="${v.price || ''}" class="p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs">
        <input id="v${rowId}_promo" type="number" min="0" step="0.01" placeholder="Promotional price (optional)" value="${v.promoPrice || ''}" class="p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs">
      </div>
      <div class="flex gap-2 mb-2">
        <input id="v${rowId}_image" placeholder="Image URL (optional)" value="${escapeHtml(v.image || '')}" class="flex-1 p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs">
        <button type="button" data-media-pick="v${rowId}_image" data-media-multiple="false" data-media-folder="/tejuboss/products" class="bg-red-50 text-red-700 px-3 rounded-lg font-bold text-[10px]">Choose image</button>
      </div>
      <img id="v${rowId}_preview" class="${v.image ? '' : 'hidden'} mb-2 h-12 rounded-lg object-cover border" src="${v.image ? escapeHtml(v.image) : ''}">
      <div class="flex justify-between items-center">
        <label class="flex items-center gap-2 text-[11px] font-bold text-gray-500"><input type="checkbox" id="v${rowId}_instock" ${v.inStock === false ? '' : 'checked'}> Option available</label>
        <button type="button" class="remove-variant-btn text-red-500 text-[11px] font-bold" data-row-id="${rowId}">Remove</button>
      </div>
    </div>`;
}
function upgradeRowHTML(rowId, u = {}) {
  return `
    <div class="upgrade-row bg-white border border-gray-200 rounded-xl p-3 flex gap-2 items-center" data-row-id="${rowId}">
      <input type="hidden" id="u${rowId}_stableId" value="${escapeHtml(u.id || '')}">
      <input id="u${rowId}_name" placeholder="Add-on name (e.g. Gift wrap)" value="${escapeHtml(u.name || '')}" class="flex-1 p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs outline-none">
      <input id="u${rowId}_price" type="number" placeholder="+₦" value="${u.price || ''}" class="w-24 p-2 bg-gray-50 rounded-lg border border-gray-200 text-xs outline-none">
      <button type="button" class="remove-upgrade-btn text-red-500 text-[11px] font-bold" data-row-id="${rowId}">Remove</button>
    </div>`;
}

function addVariantRow(data) {
  variantRowCounter++;
  const rowId = variantRowCounter;
  document.getElementById('variantRows').insertAdjacentHTML('beforeend', variantRowHTML(rowId, data));
  document.getElementById(`v${rowId}_image`).addEventListener('input', () => updateImagePreview(`v${rowId}_image`, `v${rowId}_preview`));
  document.querySelector(`.remove-variant-btn[data-row-id="${rowId}"]`).addEventListener('click', () => {
    document.querySelector(`.variant-row[data-row-id="${rowId}"]`).remove();
  });
  document.getElementById(`v${rowId}_bulkEnabled`).addEventListener('change', (e) => {
    document.getElementById(`v${rowId}_bulkFields`).classList.toggle('hidden', !e.target.checked);
  });
  document.querySelectorAll(`input[name="v${rowId}_bulkMode"]`).forEach(radio => {
    radio.addEventListener('change', () => {
      document.getElementById(`v${rowId}_bulkOwnFields`).classList.toggle('hidden', radio.value !== 'own' || !radio.checked);
    });
  });
}

function addUpgradeRow(data) {
  upgradeRowCounter++;
  const rowId = upgradeRowCounter;
  document.getElementById('upgradeRows').insertAdjacentHTML('beforeend', upgradeRowHTML(rowId, data));
  document.querySelector(`.remove-upgrade-btn[data-row-id="${rowId}"]`).addEventListener('click', () => {
    document.querySelector(`.upgrade-row[data-row-id="${rowId}"]`).remove();
  });
}

function collectVariants() {
  return [...document.querySelectorAll('.variant-row')].map(row => {
    const rowId = row.dataset.rowId;
    const stableIdInput = document.getElementById(`v${rowId}_stableId`);
    const stableId = stableIdInput.value.trim() || `option_${crypto.randomUUID()}`;
    stableIdInput.value = stableId;
    return {
      id: stableId,
      color: document.getElementById(`v${rowId}_color`).value.trim(),
      processor: document.getElementById(`v${rowId}_processor`).value.trim(),
      ram: document.getElementById(`v${rowId}_ram`).value.trim(),
      rom: document.getElementById(`v${rowId}_rom`).value.trim(),
      price: Number(document.getElementById(`v${rowId}_price`).value) || 0,
      promoPrice: Number(document.getElementById(`v${rowId}_promo`).value) || 0,
      image: document.getElementById(`v${rowId}_image`).value.trim(),
      inStock: document.getElementById(`v${rowId}_instock`).checked
    };
  });
}
function collectUpgrades() {
  return [...document.querySelectorAll('.upgrade-row')].map(row => {
    const rowId = row.dataset.rowId;
    const stableIdInput = document.getElementById(`u${rowId}_stableId`);
    const stableId = stableIdInput.value.trim() || `upgrade_${crypto.randomUUID()}`;
    stableIdInput.value = stableId;
    return {
      id: stableId,
      name: document.getElementById(`u${rowId}_name`).value.trim(),
      price: parseInt(document.getElementById(`u${rowId}_price`).value, 10) || 0
    };
  }).filter(u => u.name);
}

function resetForm() {
  productForm.reset();
  document.getElementById('editId').value = '';
  document.getElementById('formTitle').textContent = 'Add Product';
  document.getElementById('variantRows').innerHTML = '';
  document.getElementById('upgradeRows').innerHTML = '';
  document.getElementById('pInStock').checked = true;
  addVariantRow(); // always start with one empty variant row
}

function editProduct(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  document.getElementById('editId').value = p.id;
  document.getElementById('pName').value = p.name || '';
  document.getElementById('pBrand').value = p.brand || '';
  document.getElementById('pCategory').value = p.category || '';
  document.getElementById('pDesc').value = p.desc || '';
  document.getElementById('pInStock').checked = p.inStock !== false;

  document.getElementById('variantRows').innerHTML = '';
  document.getElementById('upgradeRows').innerHTML = '';
  (p.variants || []).forEach(v => addVariantRow(v));
  (p.upgrades || []).forEach(u => addUpgradeRow(u));
  if ((p.variants || []).length === 0) addVariantRow();

  document.getElementById('formTitle').textContent = 'Editing: ' + p.name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function removeProduct(id) {
  if (!confirm('Delete this product? This cannot be undone. Existing order records will remain.')) return;
  try {
    await deleteProduct(id);
    selectedProductIds.delete(id);
  } catch (error) {
    alert('Could not delete product: ' + error.message);
  }
}

async function bulkDeleteSelectedProducts() {
  const ids = [...selectedProductIds].filter(id => allProducts.some(p => p.id === id));
  if (!ids.length) return;
  const names = ids.map(id => allProducts.find(p => p.id === id)?.name || id);
  const preview = names.slice(0, 8).map(name => '• ' + name).join('\n');
  const remainder = names.length > 8 ? '\n…and ' + (names.length - 8) + ' more' : '';
  const warning = 'You are about to permanently delete ' + ids.length + ' product(s):\n\n' +
    preview + remainder + '\n\nThis cannot be undone. Products will be removed from the shop catalogue. Existing order records will remain. Continue?';
  if (!confirm(warning)) return;
  const typed = prompt('Final safety check: type DELETE to permanently remove these ' + ids.length + ' product(s).');
  if (typed !== 'DELETE') {
    alert('Bulk deletion cancelled. No products were deleted.');
    return;
  }

  const button = document.getElementById('bulkDeleteProducts');
  button.disabled = true;
  let deleted = 0;
  const failed = [];
  try {
    for (const id of ids) {
      try {
        await deleteProduct(id);
        selectedProductIds.delete(id);
        deleted++;
      } catch (error) {
        console.error('Failed to delete product', id, error);
        failed.push(id);
      }
    }
    alert(deleted + ' product(s) deleted.' + (failed.length ? ' ' + failed.length + ' failed; those products remain selected.' : ''));
  } finally {
    button.disabled = false;
    renderProductList();
  }
}

function productUpdatePayload(product, visible) {
  const variantFields = ['id', 'color', 'processor', 'ram', 'rom', 'price', 'promoPrice', 'image', 'deliveryFee', 'deliveryRoute', 'bulkSavingsEnabled', 'bulkSavingsMode', 'bulkSavingsPercent', 'bulkSavingsMinQty', 'inStock'];
  const upgradeFields = ['id', 'name', 'price'];
  return {
    name: product.name || '',
    brand: product.brand || '',
    category: product.category || '',
    desc: product.desc || '',
    inStock: visible,
    variants: (Array.isArray(product.variants) ? product.variants : []).map(variant =>
      Object.fromEntries(variantFields.filter(key => Object.prototype.hasOwnProperty.call(variant, key)).map(key => [key, variant[key]]))
    ),
    upgrades: (Array.isArray(product.upgrades) ? product.upgrades : []).map(upgrade =>
      Object.fromEntries(upgradeFields.filter(key => Object.prototype.hasOwnProperty.call(upgrade, key)).map(key => [key, upgrade[key]]))
    )
  };
}

async function bulkSetProductVisibility(visible) {
  const ids = [...selectedProductIds].filter(id => allProducts.some(product => product.id === id));
  if (!ids.length) return;
  const action = visible ? 'show' : 'hide';
  if (!confirm('Make ' + ids.length + ' selected product(s) ' + (visible ? 'visible' : 'hidden') + ' in the shop?')) return;

  const buttons = ['bulkShowProducts', 'bulkHideProducts', 'bulkDeleteProducts'];
  buttons.forEach(id => { const button = document.getElementById(id); if (button) button.disabled = true; });
  let updated = 0;
  const failed = [];
  try {
    for (const id of ids) {
      const product = allProducts.find(item => item.id === id);
      if (!product || (product.inStock !== false) === visible) {
        selectedProductIds.delete(id);
        continue;
      }
      try {
        await updateProduct(id, productUpdatePayload(product, visible));
        selectedProductIds.delete(id);
        updated++;
      } catch (error) {
        console.error('Failed to ' + action + ' product', id, error);
        failed.push(id);
      }
    }
    alert(updated + ' product(s) ' + (visible ? 'made visible' : 'hidden') + '.' + (failed.length ? ' ' + failed.length + ' failed; those products remain selected.' : ''));
  } finally {
    buttons.forEach(id => { const button = document.getElementById(id); if (button) button.disabled = false; });
    renderProductList();
  }
}

/* ---------------- LIST ---------------- */

function priceRangeLabel(product) {
  const prices = (product.variants || []).map(variant =>
    Number(variant.promoPrice) > 0 ? Number(variant.promoPrice) : Number(variant.price)
  ).filter(price => Number.isFinite(price) && price > 0);
  if (!prices.length) return '—';
  const min = Math.min(...prices), max = Math.max(...prices);
  return min === max ? '₦' + min.toLocaleString() : '₦' + min.toLocaleString() + ' – ₦' + max.toLocaleString();
}

function productEffectivePrices(product) {
  return (product.variants || []).map(variant =>
    Number(variant.promoPrice) > 0 ? Number(variant.promoPrice) : Number(variant.price)
  ).filter(price => Number.isFinite(price) && price > 0);
}

function updateProductCategoryOptions() {
  const select = document.getElementById('productCategoryFilter');
  if (!select) return;
  const current = select.value;
  const categories = [...new Set(allProducts.map(product => (product.category || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  select.innerHTML = '<option value="">All categories</option>' +
    categories.map(category => '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>').join('');
  select.value = categories.includes(current) ? current : '';
}

function renderProductList() {
  const term = document.getElementById('productSearch').value.trim().toLowerCase();
  const category = document.getElementById('productCategoryFilter')?.value || '';
  const visibility = document.getElementById('productVisibilityFilter')?.value || '';
  const availability = document.getElementById('productAvailabilityFilter')?.value || '';
  const minRaw = document.getElementById('productMinPrice')?.value.trim() || '';
  const maxRaw = document.getElementById('productMaxPrice')?.value.trim() || '';
  const minPrice = minRaw === '' ? null : Number(minRaw);
  const maxPrice = maxRaw === '' ? null : Number(maxRaw);

  const filtered = allProducts.filter(product => {
    const searchText = [product.name, product.brand, product.category, product.desc].filter(Boolean).join(' ').toLowerCase();
    const prices = productEffectivePrices(product);
    const hasAvailableVariant = (product.variants || []).some(variant => variant.inStock !== false);
    if (term && !searchText.includes(term)) return false;
    if (category && (product.category || '').trim() !== category) return false;
    if (visibility === 'visible' && product.inStock === false) return false;
    if (visibility === 'hidden' && product.inStock !== false) return false;
    if (availability === 'available' && !hasAvailableVariant) return false;
    if (availability === 'unavailable' && hasAvailableVariant) return false;
    if (minPrice !== null && !Number.isFinite(minPrice)) return false;
    if (maxPrice !== null && !Number.isFinite(maxPrice)) return false;
    if ((minPrice !== null || maxPrice !== null) && !prices.some(price =>
      (minPrice === null || price >= minPrice) && (maxPrice === null || price <= maxPrice)
    )) return false;
    return true;
  });

  const sort = document.getElementById('productSort')?.value || 'name-asc';
  filtered.sort((a, b) => {
    if (sort === 'name-desc') return (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' });
    if (sort === 'price-asc' || sort === 'price-desc') {
      const aPrices = productEffectivePrices(a), bPrices = productEffectivePrices(b);
      const aPrice = aPrices.length ? Math.min(...aPrices) : (sort === 'price-asc' ? Infinity : -Infinity);
      const bPrice = bPrices.length ? Math.min(...bPrices) : (sort === 'price-asc' ? Infinity : -Infinity);
      return sort === 'price-asc' ? aPrice - bPrice : bPrice - aPrice;
    }
    if (sort === 'variants-asc' || sort === 'variants-desc') {
      const difference = (a.variants || []).length - (b.variants || []).length;
      return sort === 'variants-asc' ? difference : -difference;
    }
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });

  document.getElementById('productCount').textContent = filtered.length === allProducts.length
    ? allProducts.length + ' items'
    : filtered.length + ' of ' + allProducts.length + ' items';

  const selectedCount = selectedProductIds.size;
  const selectedCountEl = document.getElementById('selectedProductCount');
  if (selectedCountEl) selectedCountEl.textContent = selectedCount + ' selected';
  const deleteButton = document.getElementById('bulkDeleteProducts');
  const showButton = document.getElementById('bulkShowProducts');
  const hideButton = document.getElementById('bulkHideProducts');
  if (deleteButton) {
    deleteButton.disabled = selectedCount === 0;
    deleteButton.textContent = selectedCount ? 'Delete ' + selectedCount + ' selected' : 'Delete selected';
  }
  if (showButton) showButton.disabled = selectedCount === 0;
  if (hideButton) hideButton.disabled = selectedCount === 0;

  const visibleIds = filtered.map(product => product.id);
  const selectedVisible = visibleIds.filter(id => selectedProductIds.has(id)).length;
  const selectAll = document.getElementById('selectAllVisibleProducts');
  selectAll.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;

  document.getElementById('productList').innerHTML = filtered.map(product => {
    const thumb = (product.variants && product.variants[0] && product.variants[0].image) || 'assets/pictures/placeholder.svg';
    const variantCount = (product.variants || []).length;
    return '<div class="bg-white p-4 rounded-2xl border border-gray-100 flex items-center gap-3 shadow-sm">' +
      '<input type="checkbox" data-select-product="' + escapeHtml(product.id) + '" aria-label="Select ' + escapeHtml(product.name || 'product') + '" class="w-5 h-5 flex-shrink-0 accent-red-600" ' + (selectedProductIds.has(product.id) ? 'checked' : '') + '>' +
      '<img src="' + (thumb.startsWith('http') ? escapeHtml(thumb) : escapeHtml('../' + thumb)) + '" class="w-12 h-12 rounded-lg object-cover bg-gray-100">' +
      '<div class="flex-grow min-w-0">' +
      '<h4 class="font-bold text-xs text-gray-800 leading-tight truncate">' + escapeHtml(product.name || 'Unnamed product') + '</h4>' +
      '<p class="text-[10px] text-gray-400 font-bold uppercase">' + (product.brand ? escapeHtml(product.brand) + ' · ' : '') + escapeHtml(product.category || '') + ' · ' + priceRangeLabel(product) +
      (product.inStock === false ? '<span class="text-red-400"> · HIDDEN</span>' : '') + '</p>' +
      '<p class="text-[10px] text-gray-400">' + variantCount + ' variant' + (variantCount === 1 ? '' : 's') + '</p>' +
      '<p class="text-[9px] text-gray-300 font-mono select-all">ID: ' + escapeHtml(product.id) + '</p></div>' +
      '<div class="flex flex-col gap-1 flex-shrink-0">' +
      '<button data-edit="' + escapeHtml(product.id) + '" class="text-[10px] bg-gray-100 hover:bg-black hover:text-white px-3 py-1 rounded-md font-bold transition-all">EDIT</button>' +
      '<button data-del="' + escapeHtml(product.id) + '" class="text-[10px] bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-3 py-1 rounded-md font-bold transition-all">DEL</button>' +
      '</div></div>';
  }).join('') || '<p class="text-center text-gray-400 text-sm py-10">No products match these search and filter settings.</p>';

  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => editProduct(button.dataset.edit)));
  document.querySelectorAll('[data-del]').forEach(button => button.addEventListener('click', () => removeProduct(button.dataset.del)));
  document.querySelectorAll('[data-select-product]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) selectedProductIds.add(input.dataset.selectProduct);
      else selectedProductIds.delete(input.dataset.selectProduct);
      renderProductList();
    });
  });
}

/* ---------------- EXCEL EXPORT / IMPORT ---------------- */

function exportProductsToExcel() {
  const productRows = [];
  const upgradeRows = [];

  allProducts.forEach(p => {
    (p.variants || []).forEach(v => {
      productRows.push({
        'Product ID': p.id,
        'Product Name': p.name,
        'Brand': p.brand || '',
        'Category': p.category || '',
        'Description': p.desc || '',
        'Product In Stock': p.inStock !== false,
        'Variant ID': v.id,
        'Color': v.color || '',
        'RAM': v.ram || '',
        'Storage': v.rom || '',
        'Processor': v.processor || '',
        'Price': v.price || 0,
        'Promo Price': v.promoPrice || 0,
        'Delivery Fee (blank=general)': v.deliveryFee != null ? v.deliveryFee : '',
        'Delivery Route (general/separate)': v.deliveryRoute || 'general',
        'Bulk Savings Enabled': v.bulkSavingsEnabled ? true : false,
        'Bulk Savings Mode (own/general)': v.bulkSavingsMode || 'general',
        'Bulk Savings %': v.bulkSavingsPercent || 0,
        'Bulk Savings Min Qty': v.bulkSavingsMinQty || 0,
        'Image': v.image || '',
        'Variant In Stock': v.inStock !== false
      });
    });
    (p.upgrades || []).forEach(u => {
      upgradeRows.push({
        'Product ID': p.id,
        'Product Name': p.name,
        'Upgrade Name': u.name,
        'Upgrade Price': u.price || 0
      });
    });
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productRows), 'Products');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(upgradeRows), 'Upgrades');
  XLSX.writeFile(wb, `tejuboss-products-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function showImportStatus(text) {
  const el = document.getElementById('importStatus');
  el.textContent = text;
  el.classList.remove('hidden');
}

function truthy(val) {
  return val !== false && val !== 'FALSE' && val !== 'false' && val !== 0;
}

// Mobile spreadsheet apps (Google Sheets, Excel mobile, WPS, etc.) often don't
// update a worksheet's stored !ref range when new rows/cols are typed in, which
// makes XLSX.utils.sheet_to_json() silently ignore anything outside the original
// exported range. Recompute the real used range from actual cell keys instead.
function getEffectiveRange(sheet) {
  let maxR = 0, maxC = 0;
  Object.keys(sheet).forEach(key => {
    if (key[0] === '!') return;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  });
  return { s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } };
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  showImportStatus('Reading file...');

  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const productSheet = wb.Sheets['Products'];
    const upgradeSheet = wb.Sheets['Upgrades'];
    if (!productSheet) throw new Error('No "Products" sheet found in this file.');

    const productRows = XLSX.utils.sheet_to_json(productSheet, { range: getEffectiveRange(productSheet) });
    const upgradeRows = upgradeSheet ? XLSX.utils.sheet_to_json(upgradeSheet, { range: getEffectiveRange(upgradeSheet) }) : [];
    showImportStatus(`Parsed ${productRows.length} product row(s), ${upgradeRows.length} upgrade row(s)...`);

    // Group rows into products, keyed by Product ID when present, otherwise by Product Name
    // (so multiple blank-ID rows sharing the same name become variants of one new product).
    const groups = new Map();
    productRows.forEach(row => {
      const id = (row['Product ID'] || '').toString().trim();
      const name = (row['Product Name'] || '').toString().trim();
      if (!name) return;
      const key = id || ('NEW::' + name);

      if (!groups.has(key)) {
        groups.set(key, {
          id: id || null,
          name,
          brand: (row['Brand'] || '').toString().trim(),
          category: (row['Category'] || '').toString().trim(),
          desc: (row['Description'] || '').toString().trim(),
          inStock: truthy(row['Product In Stock']),
          variants: [],
          upgrades: []
        });
      }
      const group = groups.get(key);
      const variantId = (row['Variant ID'] || '').toString().trim() || ('v' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
      const deliveryFeeRaw = row['Delivery Fee (blank=general)'];
      const deliveryFeeStr = (deliveryFeeRaw === undefined || deliveryFeeRaw === null) ? '' : deliveryFeeRaw.toString().trim();
      group.variants.push({
        id: variantId,
        color: (row['Color'] || '').toString().trim(),
        ram: (row['RAM'] || '').toString().trim(),
        rom: (row['Storage'] || '').toString().trim(),
        processor: (row['Processor'] || '').toString().trim(),
        price: parseInt(row['Price'], 10) || 0,
        promoPrice: parseInt(row['Promo Price'], 10) || 0,
        deliveryFee: deliveryFeeStr === '' ? null : parseInt(deliveryFeeStr, 10),
        deliveryRoute: (row['Delivery Route (general/separate)'] || '').toString().trim().toLowerCase() === 'separate' ? 'separate' : 'general',
        bulkSavingsEnabled: truthy(row['Bulk Savings Enabled']),
        bulkSavingsMode: (row['Bulk Savings Mode (own/general)'] || '').toString().trim().toLowerCase() === 'own' ? 'own' : 'general',
        bulkSavingsPercent: parseFloat(row['Bulk Savings %']) || 0,
        bulkSavingsMinQty: parseInt(row['Bulk Savings Min Qty'], 10) || 0,
        image: (row['Image'] || '').toString().trim(),
        inStock: truthy(row['Variant In Stock'])
      });
    });

    upgradeRows.forEach(row => {
      const id = (row['Product ID'] || '').toString().trim();
      const name = (row['Product Name'] || '').toString().trim();
      const key = id || ('NEW::' + name);
      const group = groups.get(key);
      if (!group) return; // upgrade refers to a product not present in the Products sheet
      const upgradeName = (row['Upgrade Name'] || '').toString().trim();
      if (!upgradeName) return;
      group.upgrades.push({
        id: 'u' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: upgradeName,
        price: parseInt(row['Upgrade Price'], 10) || 0
      });
    });

    let updated = 0, created = 0, failed = 0;
    let i = 0;
    for (const group of groups.values()) {
      i++;
      showImportStatus(`Saving ${i} of ${groups.size}...`);
      const productData = {
        name: group.name,
        brand: group.brand,
        category: group.category,
        desc: group.desc,
        inStock: group.inStock,
        variants: group.variants,
        upgrades: group.upgrades
      };
      try {
        if (group.id) {
          await updateProduct(group.id, productData);
          updated++;
        } else {
          await addProduct(productData);
          created++;
        }
      } catch (err) {
        console.error('Failed to save', group.name, err);
        failed++;
      }
    }

    showImportStatus(`Done: ${updated} updated, ${created} created${failed ? `, ${failed} failed (see console)` : ''}.`);
  } catch (err) {
    showImportStatus('Import failed: ' + err.message);
  } finally {
    e.target.value = ''; // allow re-importing the same file again later if needed
  }
}

/* ---------------- PUBLIC API ---------------- */

export function initProducts() {
  document.getElementById('addVariantBtn').addEventListener('click', () => addVariantRow());
  addVariantRow(); // start the form with one row visible instead of an empty box
  document.getElementById('addUpgradeBtn').addEventListener('click', () => addUpgradeRow());

  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('editId').value;

    const variants = collectVariants();
    if (variants.length === 0) return alert('Add at least one variant — that\'s what customers actually buy.');
    if (variants.some(v => !v.price)) return alert('Every variant needs a price.');

    const product = {
      name: document.getElementById('pName').value.trim(),
      brand: document.getElementById('pBrand').value.trim(),
      category: document.getElementById('pCategory').value.trim(),
      desc: document.getElementById('pDesc').value.trim(),
      inStock: document.getElementById('pInStock').checked,
      variants,
      upgrades: collectUpgrades()
    };

    try {
      if (editId) {
        await updateProduct(editId, product);
      } else {
        await addProduct(product);
      }
      resetForm();
    } catch (err) {
      alert('Failed to save product: ' + err.message);
    }
  });

  document.getElementById('resetFormBtn').addEventListener('click', resetForm);
  ['productSearch', 'productSort', 'productCategoryFilter', 'productVisibilityFilter', 'productAvailabilityFilter', 'productMinPrice', 'productMaxPrice']
    .forEach(id => document.getElementById(id)?.addEventListener('input', renderProductList));
  ['productSort', 'productCategoryFilter', 'productVisibilityFilter', 'productAvailabilityFilter']
    .forEach(id => document.getElementById(id)?.addEventListener('change', renderProductList));
  document.getElementById('clearProductFilters').addEventListener('click', () => {
    document.getElementById('productSearch').value = '';
    document.getElementById('productSort').value = 'name-asc';
    document.getElementById('productCategoryFilter').value = '';
    document.getElementById('productVisibilityFilter').value = '';
    document.getElementById('productAvailabilityFilter').value = '';
    document.getElementById('productMinPrice').value = '';
    document.getElementById('productMaxPrice').value = '';
    renderProductList();
  });
  document.getElementById('selectAllVisibleProducts').addEventListener('change', event => {
    document.querySelectorAll('[data-select-product]').forEach(input => {
      if (event.target.checked) selectedProductIds.add(input.dataset.selectProduct);
      else selectedProductIds.delete(input.dataset.selectProduct);
    });
    renderProductList();
  });
  document.getElementById('clearProductSelection').addEventListener('click', () => {
    selectedProductIds.clear();
    renderProductList();
  });
  document.getElementById('bulkDeleteProducts').addEventListener('click', bulkDeleteSelectedProducts);
  document.getElementById('bulkShowProducts').addEventListener('click', () => bulkSetProductVisibility(true));
  document.getElementById('bulkHideProducts').addEventListener('click', () => bulkSetProductVisibility(false));
  document.getElementById('exportExcelBtn').addEventListener('click', exportProductsToExcel);
  document.getElementById('importExcelInput').addEventListener('change', handleImportFile);
  updateProductCategoryOptions();
}

export function renderProducts(products) {
  allProducts = products;
  const existingIds = new Set(products.map(product => product.id));
  selectedProductIds.forEach(id => { if (!existingIds.has(id)) selectedProductIds.delete(id); });
  updateProductCategoryOptions();
  renderProductList();
}

export function getAllProducts() {
  return allProducts;
}
