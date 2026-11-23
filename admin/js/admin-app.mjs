// Tejuboss admin application shell for the clean commerce schema.
import { initFirebase } from "../../js/firebase.mjs";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { watchProducts, watchOrders } from "../../js/commerce-store.mjs";
import { initTabs } from "./admin-shared.mjs";
import { initProducts, renderProducts } from "./admin-products.mjs";
import { renderOrderList } from "./admin-orders.mjs";
import { initSettings, loadSettingsForm } from "./admin-settings.mjs";

const { auth } = initFirebase();
initTabs();
initProducts();
initSettings();
let stopProducts = null;
let stopOrders = null;

document.getElementById("loginBtn").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const error = document.getElementById("loginError");
  error.classList.add("hidden");
  try { await signInWithEmailAndPassword(auth, email, password); }
  catch { error.textContent = "Login failed. Check email and password."; error.classList.remove("hidden"); }
});
document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));
onAuthStateChanged(auth, user => {
  if (user && user.email?.toLowerCase() !== "damzyeazy@gmail.com") {
    const error = document.getElementById("loginError");
    error.textContent = "This account is not authorized for the Tejuboss administrator dashboard.";
    error.classList.remove("hidden");
    signOut(auth);
    return;
  }
  if (user) {
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
    startDashboard();
  } else {
    document.getElementById("dashboard").classList.add("hidden");
    document.getElementById("loginScreen").classList.remove("hidden");
    stopProducts?.(); stopOrders?.(); stopProducts = stopOrders = null;
  }
});
function startDashboard() {
  stopProducts?.(); stopOrders?.();
  stopProducts = watchProducts(renderProducts);
  stopOrders = watchOrders(renderOrderList);
  loadSettingsForm().catch(error => console.error("Settings could not be loaded:", error));
}
