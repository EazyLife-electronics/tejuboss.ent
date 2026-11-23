// Admin-only editor for the public settings projection.
import { initFirebase } from "../../js/firebase.mjs";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
const { db, auth } = initFirebase();
export async function loadSettingsForm() {
  const snap = await getDoc(doc(db, "siteSettings", "public"));
  const value = snap.exists() ? snap.data() : {};
  document.getElementById("s_whatsapp").value = value.whatsapp || "2347079557886";
  document.getElementById("s_tagline").value = value.tagline || "";
  document.getElementById("s_about").value = value.aboutText || "";
  document.getElementById("s_deliveryFee").value = Number(value.deliveryFeeMinor || 0) / 100;
}
export function initSettings() {
  document.getElementById("settingsForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (auth.currentUser?.email?.toLowerCase() !== "damzyeazy@gmail.com") return alert("Administrator sign-in is required.");
    const button = event.submitter;
    if (button) { button.disabled = true; button.textContent = "Saving…"; }
    try {
      await setDoc(doc(db, "siteSettings", "public"), {
        schemaVersion: 1,
        whatsapp: document.getElementById("s_whatsapp").value.trim(),
        tagline: document.getElementById("s_tagline").value.trim().slice(0, 180),
        aboutText: document.getElementById("s_about").value.trim().slice(0, 3000),
        deliveryFeeMinor: Math.round(Math.max(0, Number(document.getElementById("s_deliveryFee").value) || 0) * 100),
        updatedAt: serverTimestamp()
      }, { merge: true });
      const msg = document.getElementById("settingsMsg"); msg.classList.remove("hidden");
      setTimeout(() => msg.classList.add("hidden"), 2500);
    } catch (error) { alert("Could not save settings: " + error.message); }
    finally { if (button) { button.disabled = false; button.textContent = "Save settings"; } }
  });
}
