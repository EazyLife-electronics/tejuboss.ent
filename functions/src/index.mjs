import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";

initializeApp();

/**
 * Deployment and emulator smoke-test endpoint.
 *
 * This endpoint deliberately exposes no customer, catalogue, pricing or stock
 * data. It verifies that the callable Functions runtime is reachable before
 * business operations are introduced.
 */
export const backendStatus = onCall(
  {
    region: "europe-west1",
    enforceAppCheck: false
  },
  async (request) => {
    if (request.data && Object.keys(request.data).length > 0) {
      throw new HttpsError("invalid-argument", "This endpoint accepts no input.");
    }

    return {
      service: "tejuboss-commerce",
      status: "ready",
      version: 1,
      projectId: process.env.GCLOUD_PROJECT || null,
      timestamp: new Date().toISOString()
    };
  }
);
