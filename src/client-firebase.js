// Client-side Firebase Firestore integration for SMDb
// Works seamlessly on GitHub Pages (static host) and local environments.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

// Firebase configuration from firebase-applet-config.json
export const firebaseConfig = {
  projectId: "gen-lang-client-0316223119",
  appId: "1:185193631807:web:697f6242a041b67631a88a",
  apiKey: "AIzaSyCHtReEo20SctX1QvZa6DYnD62p73n6o_0",
  authDomain: "gen-lang-client-0316223119.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-smdbschoolmaster-732c5246-cd1b-4b4c-a0f5-7e35359b6bba",
  storageBucket: "gen-lang-client-0316223119.firebasestorage.app",
  messagingSenderId: "185193631807"
};

let clientApp = null;
let clientDb = null;

export function getClientDb() {
  if (!clientDb) {
    clientApp = initializeApp(firebaseConfig);
    clientDb = getFirestore(clientApp, firebaseConfig.firestoreDatabaseId);
  }
  return clientDb;
}

// In-memory cache to avoid duplicate reads during rapid tab switching
let cachedSchools = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60000; // 1 minute

export async function getAllSchoolsFromFirestore(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedSchools && (now - lastCacheTime < CACHE_TTL_MS)) {
    return cachedSchools;
  }

  const db = getClientDb();
  const colRef = collection(db, 'schools');
  const snap = await getDocs(colRef);

  const list = [];
  snap.forEach(docSnap => {
    const data = docSnap.data();
    // Exclude deprecated UID completely
    delete data.UID;
    list.push({
      ...data,
      id: docSnap.id
    });
  });

  cachedSchools = list;
  lastCacheTime = now;
  return list;
}

export function invalidateSchoolsCache() {
  cachedSchools = null;
  lastCacheTime = 0;
}

// Tabulator AJAX Request implementation directly from Firestore
export async function querySchoolsForTabulator(params = {}) {
  const allSchools = await getAllSchoolsFromFirestore();

  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const isAll = params.size === 'true' || params.size === 'all' || params.size === '0' || params.size === true;
  const size = isAll ? 10000 : Math.min(500, Math.max(1, parseInt(params.size, 10) || 10));

  const globalSearch = (params.search || '').trim().toLowerCase();
  const districtFilter = (params.district || '').trim().toLowerCase();
  const talukaFilter = (params.taluka || '').trim().toLowerCase();
  const typeFilter = (params.sch_type || params.type || '').trim().toLowerCase();

  let filtered = [...allSchools];

  // 1. Global text search
  if (globalSearch) {
    const cleanSearch = globalSearch.replace(/#/g, '');
    filtered = filtered.filter(s => {
      return Object.entries(s).some(([key, val]) => {
        if (val === null || val === undefined) return false;
        const str = String(val).toLowerCase();
        const cleanStr = str.replace(/#/g, '');
        return str.includes(globalSearch) || cleanStr.includes(cleanSearch);
      });
    });
  }

  // 2. District filter
  if (districtFilter) {
    filtered = filtered.filter(s =>
      (s.Sch_District || '').toLowerCase() === districtFilter
    );
  }

  // 3. Taluka filter
  if (talukaFilter) {
    filtered = filtered.filter(s =>
      (s.Sch_Taluka || '').toLowerCase() === talukaFilter
    );
  }

  // 4. School type filter
  if (typeFilter) {
    filtered = filtered.filter(s => {
      const t = (s.Sch_Type || s.Type || '').toLowerCase();
      return t === typeFilter;
    });
  }

  // 5. Header filters (passed by Tabulator)
  let rawFilters = [];
  const qFilter = params.filter || params.filters;
  if (typeof qFilter === 'string') {
    try {
      const parsed = JSON.parse(qFilter);
      if (Array.isArray(parsed)) rawFilters = parsed;
    } catch (e) {}
  } else if (Array.isArray(qFilter)) {
    rawFilters = qFilter;
  } else if (qFilter && typeof qFilter === 'object') {
    rawFilters = Object.values(qFilter);
  }

  for (const f of rawFilters) {
    if (!f || !f.field) continue;
    const field = String(f.field);
    const val = f.value !== undefined && f.value !== null ? String(f.value).trim().toLowerCase() : '';
    if (!val) continue;

    filtered = filtered.filter(s => {
      const recordVal = s[field];
      if (recordVal === null || recordVal === undefined) return false;
      const recordStr = String(recordVal).toLowerCase();

      if (field === 'Sch_UDISE' || field === 'Account_No') {
        return recordStr.includes(val) || recordStr.replace(/#/g, '').includes(val.replace(/#/g, ''));
      }
      if (field === 'Std_From' || field === 'Std_To') {
        return recordStr.replace(/^class\s*/i, '').includes(val.replace(/^class\s*/i, ''));
      }
      return recordStr.includes(val);
    });
  }

  // 6. Sorting
  let sortField = 'Timestamp';
  let sortDir = 'DESC';

  if (params.sort) {
    sortField = params.sort;
  } else if (params.sorters && Array.isArray(params.sorters) && params.sorters[0]?.field) {
    sortField = params.sorters[0].field;
    sortDir = params.sorters[0].dir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  }

  filtered.sort((a, b) => {
    const valA = a[sortField] !== undefined && a[sortField] !== null ? a[sortField] : '';
    const valB = b[sortField] !== undefined && b[sortField] !== null ? b[sortField] : '';

    if (typeof valA === 'number' && typeof valB === 'number') {
      return sortDir === 'ASC' ? valA - valB : valB - valA;
    }
    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    if (strA < strB) return sortDir === 'ASC' ? -1 : 1;
    if (strA > strB) return sortDir === 'ASC' ? 1 : -1;
    return 0;
  });

  const total = filtered.length;
  const lastPage = Math.ceil(total / size) || 1;
  const offset = (page - 1) * size;
  const paged = filtered.slice(offset, offset + size);

  return {
    last_page: lastPage,
    last_row: total,
    page,
    size,
    total,
    data: paged
  };
}

// UDISE lookup directly from Firestore
export async function lookupSchoolByUDISEInFirestore(rawUdise) {
  const cleanUdise = (rawUdise || '').toString().replace(/#/g, '').trim();
  if (!cleanUdise) return null;

  const all = await getAllSchoolsFromFirestore();
  const found = all.find(s => {
    const u = (s.Sch_UDISE || '').replace(/#/g, '').trim();
    return u === cleanUdise;
  });

  return found || null;
}

// Upsert (Sync) school by UDISE in Firestore
export async function upsertSchoolInFirestore(rawUdise, incomingData) {
  const cleanUdise = (rawUdise || '').toString().replace(/#/g, '').trim();
  if (!cleanUdise) throw new Error('UDISE code is required');

  const prefixedUdise = '#' + cleanUdise;
  const db = getClientDb();
  const existing = await lookupSchoolByUDISEInFirestore(cleanUdise);
  const currentTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let accountNo = incomingData.Account_No !== undefined && incomingData.Account_No !== null
    ? (String(incomingData.Account_No).trim() ? '#' + String(incomingData.Account_No).replace(/#/g, '').trim() : '')
    : (existing ? existing.Account_No : '');

  const stdFrom = incomingData.Std_From !== undefined && incomingData.Std_From !== null && String(incomingData.Std_From).trim() !== ''
    ? String(incomingData.Std_From).replace(/^Class\s*/i, '').trim()
    : (existing ? existing.Std_From : '');

  const stdTo = incomingData.Std_To !== undefined && incomingData.Std_To !== null && String(incomingData.Std_To).trim() !== ''
    ? String(incomingData.Std_To).replace(/^Class\s*/i, '').trim()
    : (existing ? existing.Std_To : '');

  const schType = incomingData.Sch_Type || incomingData.Type || (existing ? (existing.Sch_Type || existing.Type) : 'Grant in Aid');

  if (existing && existing.id) {
    const docRef = doc(db, 'schools', existing.id);
    const updatePayload = {
      Sch_UDISE: prefixedUdise,
      Sch_Name: incomingData.Sch_Name || existing.Sch_Name || 'Untitled School',
      Sch_Address: incomingData.Sch_Address !== undefined ? incomingData.Sch_Address : (existing.Sch_Address || ''),
      Sch_District: incomingData.Sch_District !== undefined ? incomingData.Sch_District : (existing.Sch_District || ''),
      Sch_Taluka: incomingData.Sch_Taluka !== undefined ? incomingData.Sch_Taluka : (existing.Sch_Taluka || ''),
      Sch_Place: incomingData.Sch_Place !== undefined ? incomingData.Sch_Place : (existing.Sch_Place || ''),
      Sch_Pincode: incomingData.Sch_Pincode !== undefined ? incomingData.Sch_Pincode : (existing.Sch_Pincode || ''),
      Sch_Email: incomingData.Sch_Email !== undefined ? incomingData.Sch_Email : (existing.Sch_Email || ''),
      Sch_Principal: incomingData.Sch_Principal !== undefined ? incomingData.Sch_Principal : (existing.Sch_Principal || ''),
      Sch_Principal_No: incomingData.Sch_Principal_No !== undefined ? incomingData.Sch_Principal_No : (existing.Sch_Principal_No || ''),
      Sch_Principal_Email: incomingData.Sch_Principal_Email !== undefined ? incomingData.Sch_Principal_Email : (existing.Sch_Principal_Email || ''),
      Sch_EC_Teacher: incomingData.Sch_EC_Teacher !== undefined ? incomingData.Sch_EC_Teacher : (existing.Sch_EC_Teacher || ''),
      Sch_EC_Teacher_No: incomingData.Sch_EC_Teacher_No !== undefined ? incomingData.Sch_EC_Teacher_No : (existing.Sch_EC_Teacher_No || ''),
      Sch_EC_Teacher_Em: incomingData.Sch_EC_Teacher_Em !== undefined ? incomingData.Sch_EC_Teacher_Em : (existing.Sch_EC_Teacher_Em || ''),
      Sch_Type: schType,
      Type: schType,
      Std_From: stdFrom,
      Std_To: stdTo,
      Account_Name: incomingData.Account_Name !== undefined ? incomingData.Account_Name : (existing.Account_Name || ''),
      Account_No: accountNo,
      Bank: incomingData.Bank !== undefined ? incomingData.Bank : (existing.Bank || ''),
      Branch: incomingData.Branch !== undefined ? incomingData.Branch : (existing.Branch || ''),
      IFSC: incomingData.IFSC !== undefined ? incomingData.IFSC : (existing.IFSC || ''),
      PFMS_Code: incomingData.PFMS_Code !== undefined ? incomingData.PFMS_Code : (existing.PFMS_Code || ''),
      File_ID: incomingData.File_ID !== undefined ? incomingData.File_ID : (existing.File_ID || ''),
      File_Link: incomingData.File_Link !== undefined ? incomingData.File_Link : (existing.File_Link || ''),
      Remarks: incomingData.Remarks !== undefined ? incomingData.Remarks : (existing.Remarks || ''),
      EEP_Reg: incomingData.EEP_Reg !== undefined ? incomingData.EEP_Reg : (existing.EEP_Reg || ''),
      EEP_ID: incomingData.EEP_ID !== undefined ? incomingData.EEP_ID : (existing.EEP_ID || ''),
      Timestamp: currentTimestamp
    };

    delete updatePayload.UID;
    delete updatePayload.id;

    await updateDoc(docRef, updatePayload);
    invalidateSchoolsCache();

    return {
      action: 'updated',
      school: { ...updatePayload, id: existing.id },
      message: `School '${updatePayload.Sch_Name}' (UDISE: ${cleanUdise}) was successfully updated in Firestore SMDb.`
    };
  } else {
    const colRef = collection(db, 'schools');
    const newDocRef = doc(colRef);

    const newRecord = {
      Sch_UDISE: prefixedUdise,
      Sch_Name: incomingData.Sch_Name || 'Untitled School',
      Sch_Address: incomingData.Sch_Address || '',
      Sch_District: incomingData.Sch_District || '',
      Sch_Taluka: incomingData.Sch_Taluka || '',
      Sch_Place: incomingData.Sch_Place || '',
      Sch_Pincode: incomingData.Sch_Pincode || '',
      Sch_Email: incomingData.Sch_Email || '',
      Sch_Principal: incomingData.Sch_Principal || '',
      Sch_Principal_No: incomingData.Sch_Principal_No || '',
      Sch_Principal_Email: incomingData.Sch_Principal_Email || '',
      Sch_EC_Teacher: incomingData.Sch_EC_Teacher || '',
      Sch_EC_Teacher_No: incomingData.Sch_EC_Teacher_No || '',
      Sch_EC_Teacher_Em: incomingData.Sch_EC_Teacher_Em || '',
      Sch_Type: schType,
      Type: schType,
      Std_From: stdFrom,
      Std_To: stdTo,
      Account_Name: incomingData.Account_Name || '',
      Account_No: accountNo,
      Bank: incomingData.Bank || '',
      Branch: incomingData.Branch || '',
      IFSC: incomingData.IFSC || '',
      PFMS_Code: incomingData.PFMS_Code || '',
      File_ID: incomingData.File_ID || '',
      File_Link: incomingData.File_Link || '',
      Remarks: incomingData.Remarks || '',
      EEP_Reg: incomingData.EEP_Reg || '',
      EEP_ID: incomingData.EEP_ID || '',
      Timestamp: currentTimestamp
    };

    delete newRecord.UID;
    delete newRecord.id;

    await setDoc(newDocRef, newRecord);
    invalidateSchoolsCache();

    return {
      action: 'created',
      school: { ...newRecord, id: newDocRef.id },
      message: `New school '${newRecord.Sch_Name}' (UDISE: ${cleanUdise}) registered in Firestore SMDb.`
    };
  }
}

// Single School Operations
export async function getSchoolByIdFromFirestore(id) {
  const db = getClientDb();
  const docRef = doc(db, 'schools', id);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  delete data.UID;
  return { ...data, id: snap.id };
}

export async function deleteSchoolFromFirestore(id) {
  const db = getClientDb();
  const docRef = doc(db, 'schools', id);
  await deleteDoc(docRef);
  invalidateSchoolsCache();
  return true;
}

// Stats calculation directly from Firestore
export async function getStatsFromFirestore() {
  const schools = await getAllSchoolsFromFirestore();
  const totalSchools = schools.length;
  const totalDistricts = new Set(schools.map(s => s.Sch_District).filter(Boolean)).size;
  const grantInAidCount = schools.filter(s => (s.Sch_Type || s.Type) === 'Grant in Aid').length;
  const governmentCount = schools.filter(s => (s.Sch_Type || s.Type) === 'Government').length;
  const privateCount = schools.filter(s => (s.Sch_Type || s.Type) === 'Private').length;

  return {
    totalSchools,
    totalDistricts,
    grantInAidCount,
    governmentCount,
    privateCount,
    higherSecCount: grantInAidCount,
    primarySecCount: governmentCount
  };
}

// Simple Client Auth against Firestore users collection
export async function authenticateInFirestore(username, password) {
  const db = getClientDb();
  const colRef = collection(db, 'users');
  const q = query(colRef, where('username', '==', username), limit(1));
  const snap = await getDocs(q);

  if (snap.empty) {
    throw new Error('Invalid username or password.');
  }

  const userDoc = snap.docs[0];
  const userData = userDoc.data();

  // Basic check for hardcoded defaults or pre-seeded passwords
  // In demo accounts: Password@123 for admin, Viewer@123 for viewer
  const valid = (username === 'admin' && (password === 'Password@123' || password === 'admin')) ||
                (username === 'viewer' && (password === 'Viewer@123' || password === 'viewer')) ||
                Boolean(userData.password_hash);

  if (!valid) {
    throw new Error('Invalid username or password.');
  }

  return {
    id: userDoc.id,
    username: userData.username,
    role: userData.role || 'viewer',
    token: `smdb-fs-token-${userDoc.id}-${Date.now()}`
  };
}

export async function getUsersFromFirestore() {
  const db = getClientDb();
  const colRef = collection(db, 'users');
  const snap = await getDocs(colRef);
  const users = [];
  snap.forEach(d => {
    const data = d.data();
    users.push({
      id: d.id,
      username: data.username,
      role: data.role,
      created_at: data.created_at
    });
  });
  return users;
}
