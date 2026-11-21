import { initFirebase } from "../../js/firebase.mjs";
import { watchProducts } from "../../js/store.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { escapeHtml } from "./admin-shared.mjs";

const root = document.getElementById("quantityPricingContent");
if (root) {
  const { app, auth } = initFirebase();
  const functions = getFunctions(app, "europe-west1");
  const getConfig = httpsCallable(functions, "getQuantityPricingConfig");
  const publish = httpsCallable(functions, "publishQuantityPricing");
  let products = [];
  let configVersion = 0;
  let loadedRules = {};
  let tierCounter = 0;

  root.innerHTML = `
    <section class="bg-white rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
      <div>
        <h2 class="font-black text-lg">Quantity & Bulk Pricing</h2>
        <p class="text-xs text-gray-500 mt-1">Create public quantity offers such as “Buy 5+ at ₦900 each”. Customers do not need an account.</p>
      </div>
      <div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
        <strong>Important:</strong> An offer can be saved as a private draft now. Activating it publicly requires the product to be migrated to the new published catalogue with stable selling-option IDs. Existing legacy product labels are not treated as unit conversions.
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs font-bold text-gray-600">Product
          <select id="qpProduct" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm"><option value="">Choose product</option></select>
        </label>
        <label class="text-xs font-bold text-gray-600">Variant
          <select id="qpVariant" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm"><option value="">Choose variant</option></select>
        </label>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs font-bold text-gray-600">Rule ID
          <input id="qpRuleId" value="bulk-offer" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm">
        </label>
        <label class="text-xs font-bold text-gray-600">Pricing behaviour
          <select id="qpMode" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm">
            <option value="threshold">Threshold: best reached price applies to all</option>
            <option value="marginal">Marginal: each quantity band has its own price</option>
          </select>
        </label>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs font-bold text-gray-600">Qualification basis
          <select id="qpBasis" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm">
            <option value="selected_option_quantity">Selected selling option quantity</option>
            <option value="base_stock_quantity">Base-stock equivalent quantity</option>
          </select>
        </label>
        <label class="text-xs font-bold text-gray-600">Eligible selling-option IDs
          <input id="qpOptions" placeholder="e.g. piece, pack-6, carton-48" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm">
        </label>
      </div>
      <label class="flex items-center gap-2 text-xs font-bold text-gray-600"><input id="qpAggregate" type="checkbox"> Allow eligible options to combine for qualification</label>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs font-bold text-gray-600">Offer starts (optional)
          <input id="qpStart" type="datetime-local" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm">
        </label>
        <label class="text-xs font-bold text-gray-600">Offer ends (optional)
          <input id="qpEnd" type="datetime-local" class="mt-1 w-full p-3 rounded-xl border bg-gray-50 text-sm">
        </label>
      </div>
      <div class="border-t pt-4">
        <div class="flex justify-between items-center gap-2 mb-3">
          <div><h3 class="font-black text-sm">Price tiers</h3><p class="text-[11px] text-gray-500">Prices are entered in naira. Internally saved in kobo.</p></div>
          <button id="qpAddTier" type="button" class="bg-gray-900 text-white px-3 py-2 rounded-lg text-xs font-bold">+ Add tier</button>
        </div>
        <div id="qpTiers" class="space-y-2"></div>
      </div>
      <div class="flex items-center gap-2 bg-gray-50 rounded-xl p-3">
        <input id="qpEnabled" type="checkbox">
        <label for="qpEnabled" class="text-xs font-bold text-gray-700">Activate offer publicly after saving</label>
      </div>
      <div class="flex flex-col sm:flex-row gap-2">
        <button id="qpSave" type="button" class="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold text-sm">Save pricing rule</button>
        <button id="qpReload" type="button" class="bg-gray-100 text-gray-700 px-4 py-3 rounded-xl font-bold text-sm">Reload saved rules</button>
      </div>
      <p id="qpStatus" role="status" class="text-xs text-gray-600 min-h-5"></p>
      <div id="qpSaved" class="border-t pt-4">
        <h3 class="font-black text-sm mb-2">Saved rules for selected variant</h3>
        <div id="qpSavedList" class="space-y-2 text-xs text-gray-500">Choose a product and variant to load pricing.</div>
      </div>
    </section>`;

  const el = id => document.getElementById(id);
  const status = message => { el("qpStatus").textContent = message; };
  const moneyMinor = value => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100))) {
      throw new Error("Enter a valid non-negative price in naira.");
    }
    return Math.round(n * 100);
  };
  const formatNaira = minor => (Number(minor || 0) / 100).toLocaleString("en-NG", {
    style: "currency", currency: "NGN", maximumFractionDigits: 2
  });

  function addTier(tier = {}) {
    tierCounter += 1;
    const id = tierCounter;
    const price = el("qpBasis").value === "base_stock_quantity"
      ? tier.pricePerBaseUnitMinor
      : tier.priceBySellingOptionId?.[el("qpOptions").value.trim().split(",")[0]?.trim()];
    el("qpTiers").insertAdjacentHTML("beforeend", `
      <div class="qp-tier grid grid-cols-2 sm:grid-cols-4 gap-2 bg-gray-50 border rounded-xl p-3" data-tier="${id}">
        <label class="text-[10px] font-bold text-gray-500">Minimum qty
          <input data-min type="number" min="1" step="1" value="${tier.minimumQuantity ?? 1}" class="mt-1 w-full p-2 rounded-lg border text-sm">
        </label>
        <label class="text-[10px] font-bold text-gray-500">Maximum qty
          <input data-max type="number" min="1" step="1" value="${tier.maximumQuantity ?? ""}" placeholder="No maximum" class="mt-1 w-full p-2 rounded-lg border text-sm">
        </label>
        <label class="text-[10px] font-bold text-gray-500">Price (₦)
          <input data-price type="number" min="0" step="0.01" value="${price != null ? Number(price) / 100 : ""}" placeholder="e.g. 900" class="mt-1 w-full p-2 rounded-lg border text-sm">
        </label>
        <button type="button" data-remove class="self-end p-2 rounded-lg bg-red-50 text-red-600 text-xs font-bold">Remove</button>
      </div>`);
    el("qpTiers").querySelector(`[data-tier="${id}"] [data-remove]`).addEventListener("click", () => {
      el("qpTiers").querySelector(`[data-tier="${id}"]`).remove();
    });
  }

  function selectedProduct() {
    return products.find(p => p.id === el("qpProduct").value);
  }

  function refreshVariants() {
    const product = selectedProduct();
    const variants = product?.variants || [];
    el("qpVariant").innerHTML = '<option value="">Choose variant</option>' +
      variants.map(v => `<option value="${escapeHtml(v.id || "")}">${escapeHtml([v.color, v.processor, v.ram, v.rom].filter(Boolean).join(" / ") || v.id || "Unnamed variant")}</option>`).join("");
    el("qpSavedList").textContent = "Choose a variant to load its saved rules.";
    configVersion = 0;
    loadedRules = {};
  }

  function renderSavedRules() {
    const entries = Object.entries(loadedRules);
    el("qpSavedList").innerHTML = entries.length ? entries.map(([id, rule]) => `
      <button type="button" data-load-rule="${escapeHtml(id)}" class="w-full text-left border rounded-lg p-3 bg-white">
        <span class="font-bold text-gray-800">${escapeHtml(id)}</span>
        <span class="block text-gray-500">${rule.enabled ? "Active configuration" : "Draft/disabled"} · ${escapeHtml(rule.pricingMode)} · ${(rule.tiers || []).length} tiers</span>
      </button>`).join("") : "No saved rules for this variant yet.";
    el("qpSavedList").querySelectorAll("[data-load-rule]").forEach(button => {
      button.addEventListener("click", () => loadRule(button.dataset.loadRule));
    });
  }

  function loadRule(id) {
    const rule = loadedRules[id];
    if (!rule) return;
    el("qpRuleId").value = id;
    el("qpMode").value = rule.pricingMode;
    el("qpBasis").value = rule.qualificationBasis;
    el("qpOptions").value = (rule.eligibleSellingOptionIds || []).join(", ");
    el("qpAggregate").checked = rule.aggregateAcrossOptions === true;
    el("qpEnabled").checked = rule.enabled === true;
    el("qpStart").value = rule.effectiveFromMillis ? new Date(rule.effectiveFromMillis).toISOString().slice(0,16) : "";
    el("qpEnd").value = rule.effectiveUntilMillis ? new Date(rule.effectiveUntilMillis).toISOString().slice(0,16) : "";
    el("qpTiers").innerHTML = "";
    (rule.tiers || []).forEach(addTier);
    status(`Loaded ${id}. Saving will update this rule using configuration version ${configVersion}.`);
  }

  async function reloadConfig() {
    const productId = el("qpProduct").value;
    const variantId = el("qpVariant").value;
    if (!productId || !variantId) return status("Choose a product and variant first.");
    status("Loading saved pricing configuration…");
    try {
      const response = await getConfig({ productId, variantId });
      configVersion = response.data.version || 0;
      loadedRules = response.data.rules || {};
      renderSavedRules();
      status(`Loaded ${Object.keys(loadedRules).length} saved rule(s). Version v${configVersion}.`);
    } catch (error) {
      status(error.message || "Could not load pricing configuration.");
    }
  }

  function collectRule() {
    const productId = el("qpProduct").value;
    const variantId = el("qpVariant").value;
    if (!productId || !variantId) throw new Error("Choose a product and variant.");
    const ruleId = el("qpRuleId").value.trim();
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(ruleId)) throw new Error("Rule ID may contain letters, numbers, dots, underscores and hyphens.");
    const options = [...new Set(el("qpOptions").value.split(",").map(x => x.trim()).filter(Boolean))];
    const basis = el("qpBasis").value;
    if (!options.length) throw new Error("Enter at least one stable selling-option ID.");
    if (basis === "selected_option_quantity" && options.length !== 1) {
      throw new Error("Selected-option pricing requires exactly one selling-option ID. Use separate rules for each selling level.");
    }
    const tiers = [...el("qpTiers").querySelectorAll(".qp-tier")].map(row => {
      const min = Number(row.querySelector("[data-min]").value);
      const maxRaw = row.querySelector("[data-max]").value.trim();
      const priceMinor = moneyMinor(row.querySelector("[data-price]").value);
      const tier = {
        id: `tier-${min}`,
        minimumQuantity: min,
        ...(maxRaw ? { maximumQuantity: Number(maxRaw) } : {})
      };
      if (basis === "base_stock_quantity") tier.pricePerBaseUnitMinor = priceMinor;
      else tier.priceBySellingOptionId = { [options[0]]: priceMinor };
      return tier;
    }).sort((a,b) => a.minimumQuantity - b.minimumQuantity);
    if (!tiers.length) throw new Error("Add at least one price tier.");
    const toMillis = value => value ? Date.parse(value) : null;
    const start = toMillis(el("qpStart").value);
    const end = toMillis(el("qpEnd").value);
    if (start !== null && !Number.isFinite(start) || end !== null && !Number.isFinite(end)) {
      throw new Error("Check the offer start/end dates.");
    }
    if (start !== null && end !== null && end <= start) throw new Error("Offer end must be later than its start.");
    return {
      productId, variantId,
      rule: {
        id: ruleId,
        enabled: el("qpEnabled").checked,
        qualificationBasis: basis,
        aggregateAcrossOptions: el("qpAggregate").checked,
        eligibleSellingOptionIds: options,
        pricingMode: el("qpMode").value,
        tiers,
        ...(start !== null ? { effectiveFromMillis: start } : {}),
        ...(end !== null ? { effectiveUntilMillis: end } : {})
      }
    };
  }

  el("qpAddTier").addEventListener("click", () => addTier());
  el("qpProduct").addEventListener("change", refreshVariants);
  el("qpVariant").addEventListener("change", reloadConfig);
  el("qpReload").addEventListener("click", reloadConfig);
  el("qpSave").addEventListener("click", async () => {
    try {
      const payload = collectRule();
      status("Saving pricing configuration…");
      el("qpSave").disabled = true;
      const response = await publish({ ...payload, expectedVersion: configVersion });
      configVersion = response.data.configVersion;
      status(`Saved v${configVersion}. State: ${response.data.publicationState}. ${response.data.enabled ? "Offer is publicly active." : "Saved privately/inactive; no public offer is visible."}`);
      await reloadConfig();
    } catch (error) {
      status(error.message || "Could not save pricing rule.");
    } finally {
      el("qpSave").disabled = false;
    }
  });

  onAuthStateChanged(auth, user => {
    if (!user) return;
    watchProducts(next => {
      products = next || [];
      const current = el("qpProduct").value;
      el("qpProduct").innerHTML = '<option value="">Choose product</option>' +
        products.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join("");
      if (current && products.some(p => p.id === current)) el("qpProduct").value = current;
      refreshVariants();
    });
  });
}
