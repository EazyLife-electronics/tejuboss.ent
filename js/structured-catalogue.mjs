// Read-only adapter for the new structured public catalogue.
// This module does not write orders, calculate stock availability or reserve stock.
import { initFirebase } from "./firebase.mjs";
import {
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { toPublicCatalogueCard } from "../functions/src/domain/public-catalogue-view.mjs";

const { db } = initFirebase();

export async function getPublishedStructuredCatalogue() {
  // The published == true constraint is required by firestore.next.rules.
  const publishedQuery = query(
    collection(db, "catalogueProducts"),
    where("published", "==", true)
  );
  const snapshot = await getDocs(publishedQuery);
  const products = [];
  const rejected = [];

  snapshot.docs.forEach(document => {
    try {
      products.push(toPublicCatalogueCard(document.data(), document.id));
    } catch (error) {
      console.warn("Skipping invalid structured catalogue record:", document.id, error);
      rejected.push(document.id);
    }
  });

  return { products, rejectedCount: rejected.length };
}
