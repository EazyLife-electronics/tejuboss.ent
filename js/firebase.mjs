// js/firebase.mjs
// Central Firebase init — imported by shop.html and admin pages.
// TejuBoss uses its own Firebase project.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";

import "../admin/js/settings-ui.mjs";
import "../admin/js/tejuboss-brand.mjs";

const firebaseConfig = {
  apiKey: "AIzaSyDssM9wElYg5XwJMS8d_gzOZQuoJ_qd29w",
  authDomain: "tejuboss-ent.firebaseapp.com",
  projectId: "tejuboss-ent",
  storageBucket: "tejuboss-ent.firebasestorage.app",
  messagingSenderId: "513166880581",
  appId: "1:513166880581:web:8afd14f8409e0864c5582c",
  measurementId: "G-195KYYZY1H"
};

// TejuBoss reCAPTCHA Enterprise site key.
// Keep Firebase App Check enforcement OFF until staging verification is complete.
const RECAPTCHA_ENTERPRISE_SITE_KEY = "6LfYMy0uAAAAAD-WU-l6gEzXq7CzFrlyE4M-Gmvi";

let cached = null;

export function initFirebase() {
  if (cached) return cached;

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const auth = getAuth(app);
  let appCheck = null;

  // Initialize App Check with the matching reCAPTCHA Enterprise provider.
  if (RECAPTCHA_ENTERPRISE_SITE_KEY) {
    try {
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
        isTokenAutoRefreshEnabled: true
      });
    } catch (err) {
      console.warn("App Check could not initialize:", err);
    }
  }

  cached = { app, db, auth, appCheck };

  // Admin-only modules
  if (
    typeof location !== "undefined" &&
    location.pathname.includes("/admin/")
  ) {
    import("../admin/js/purchases.mjs")
      .catch(err =>
        console.warn("Purchase module could not load:", err)
      );

    import("../admin/js/payments-ui.mjs")
      .then(({ initPaymentsUI }) => initPaymentsUI(db))
      .catch(err =>
        console.warn("Payment UI could not load:", err)
      );
  }

  return cached;
}
