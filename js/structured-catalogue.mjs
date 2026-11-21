// Read-only adapter for the new structured public catalogue and public tier offers.
// This module does not write orders, calculate stock availability or reserve stock.
import { initFirebase } from "./firebase.mjs";
import {
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { toPublicCatalogueCard } from "../functions/src/domain/public-catalogue-view.mjs";

const { db } = initFirebase();

export async function getPublishedStructuredCatalogue() {
  // These constraints are required by firestore.next.rules.
  const productsQuery = query(
    collection(db, "catalogueProducts"),
    where("published", "==", true)
  );
  const pricingQuery = query(
    collection(db, "publicPricing"),
    where("enabled", "==", true)
  );
  const [productSnapshot, pricingSnapshot] = await Promise.all([
    getDocs(productsQuery),
    getDocs(pricingQuery)
  ]);

  const products = [];
  const rejected = [];
  productSnapshot.docs.forEach(document => {
    try {
      products.push(toPublicCatalogueCard(document.data(), document.id));
    } catch (error) {
      console.warn("Skipping invalid structured catalogue record:", document.id, error);
      rejected.push(document.id);
    }
  });

  const publicPricing = pricingSnapshot.docs
    .map(document => ({ ...document.data(), publicPricingId: document.id }))
    .filter(record => record.publicationState === "published" && record.enabled === true);

  return { products, publicPricing, rejectedCount: rejected.length };
}
