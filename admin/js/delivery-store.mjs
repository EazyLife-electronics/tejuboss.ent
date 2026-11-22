// admin/js/delivery-store.mjs
// Delivery configuration and mutations are handled by App Check protected Functions.
// Snapshot listeners remain read-only and are restricted by Firestore rules.
import { initFirebase } from '../../js/firebase.mjs';
import { collection, onSnapshot, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const { app, db } = initFirebase();
const functions = getFunctions(app, 'europe-west1');
const manageConfigCall = httpsCallable(functions, 'manageLegacyDeliveryConfig');
const createDeliveryCall = httpsCallable(functions, 'createLegacyDelivery');
const updateDeliveryCall = httpsCallable(functions, 'updateLegacyDelivery');
const listDeliveryOrdersCall = httpsCallable(functions, 'listLegacyDeliveryOrders');
const watch = (name, cb) => onSnapshot(collection(db,name), s => cb(s.docs.map(d=>({id:d.id,...d.data()}))));
const CONFIG_FIELDS = {
  deliveryPersonnel: ['name','phone','email','active'],
  deliveryTypes: ['name','description','active'],
  deliveryCheckpoints: ['name','address','active']
};
const cleanConfig = (collectionName, data) => Object.fromEntries(
  Object.entries(data || {}).filter(([key]) => CONFIG_FIELDS[collectionName]?.includes(key))
);
const manage = (collectionName, action, id, data) => manageConfigCall({
  collectionName, action, ...(id ? { id } : {}), ...(data ? { data: cleanConfig(collectionName, data) } : {})
});

export const watchDeliveryPersonnel = cb => watch('deliveryPersonnel',cb);
export const addDeliveryPersonnel = data => manage('deliveryPersonnel','create',null,data);
export const updateDeliveryPersonnel = (id,data) => manage('deliveryPersonnel','update',id,data);
export const deleteDeliveryPersonnel = id => manage('deliveryPersonnel','delete',id);
export const watchDeliveryTypes = cb => watch('deliveryTypes',cb);
export const addDeliveryType = data => manage('deliveryTypes','create',null,data);
export const updateDeliveryType = (id,data) => manage('deliveryTypes','update',id,data);
export const deleteDeliveryType = id => manage('deliveryTypes','delete',id);
export const watchDeliveryCheckpoints = cb => watch('deliveryCheckpoints',cb);
export const addDeliveryCheckpoint = data => manage('deliveryCheckpoints','create',null,data);
export const updateDeliveryCheckpoint = (id,data) => manage('deliveryCheckpoints','update',id,data);
export const deleteDeliveryCheckpoint = id => manage('deliveryCheckpoints','delete',id);
export const createDelivery = data => createDeliveryCall({
  orderId: data.orderId,
  deliveryTypeId: data.deliveryTypeId || null,
  personnelId: data.assignedTo || data.personnelId || null
}).then(result => ({ id: result.data.id, alreadyExists: Boolean(result.data.alreadyExists) }));
export const watchDeliveries = cb => watch('deliveries',cb);
export const updateDelivery = (id,data) => {
  const patch = { ...data };
  for (const field of ['assignedToName','assignedToPhone','deliveryType','lastCheckpointName']) delete patch[field];
  return updateDeliveryCall({ deliveryId:id, patch });
};

// Read-only compatibility helper. Creation itself is idempotent and authoritative in Functions.
export async function findActiveDeliveryForOrder(orderId) {
  const snap = await getDocs(query(collection(db, 'deliveries'), where('orderId', '==', orderId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .find(d => !['cancelled', 'returned'].includes(d.status)) || null;
}

export const watchDeliveryOrders = callback => {
  let active = true;
  const refresh = async () => {
    try {
      const result = await listDeliveryOrdersCall({});
      if (active) callback(result.data?.orders || []);
    } catch (error) {
      console.error('Could not refresh delivery queue orders:', error);
    }
  };
  refresh();
  const timer = setInterval(refresh, 60000);
  return () => { active = false; clearInterval(timer); };
};
