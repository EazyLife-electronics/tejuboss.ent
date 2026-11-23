// Minimal Tejuboss admin settings form. No legacy EazyLife or commerce workflows.
const panel = document.getElementById("panel-settings");
if (panel) {
  const host = document.getElementById("settingsContent") || panel;
  host.innerHTML = `
    <section class="bg-white rounded-2xl border p-5">
      <h2 class="font-black text-lg mb-1">Public site settings</h2>
      <p class="text-xs text-gray-500 mb-4">These values are stored in siteSettings/public. Only safe public-facing information belongs here.</p>
      <form id="settingsForm" class="space-y-3">
        <label class="block text-xs font-bold">WhatsApp number<input id="s_whatsapp" class="mt-1 w-full border rounded-xl p-3 text-sm" placeholder="2347079557886"></label>
        <label class="block text-xs font-bold">Shop tagline<input id="s_tagline" class="mt-1 w-full border rounded-xl p-3 text-sm"></label>
        <label class="block text-xs font-bold">About the business<textarea id="s_about" rows="4" class="mt-1 w-full border rounded-xl p-3 text-sm"></textarea></label>
        <label class="block text-xs font-bold">Default delivery fee (₦)<input id="s_deliveryFee" type="number" min="0" step="1" class="mt-1 w-full border rounded-xl p-3 text-sm"></label>
        <button class="bg-gray-900 text-white rounded-xl px-5 py-3 text-sm font-bold">Save settings</button>
        <span id="settingsMsg" class="hidden text-xs font-bold text-green-700">Saved.</span>
      </form>
    </section>`;
}
