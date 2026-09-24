import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { firestoreDb, firebaseAuth } from './firebase.ts';
import { db as sqliteDb } from './db.ts';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: firebaseAuth.currentUser?.uid,
      email: firebaseAuth.currentUser?.email,
      emailVerified: firebaseAuth.currentUser?.emailVerified,
      isAnonymous: firebaseAuth.currentUser?.isAnonymous,
      tenantId: firebaseAuth.currentUser?.tenantId,
      providerInfo: firebaseAuth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('[Firestore Error]', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface SchoolRecord {
  id?: string;
  Sch_UDISE: string;
  Sch_Name: string;
  Sch_Address?: string;
  Sch_District?: string;
  Sch_Taluka?: string;
  Sch_Place?: string;
  Sch_Pincode?: string;
  Sch_Email?: string;
  Sch_Principal?: string;
  Sch_Principal_No?: string;
  Sch_Principal_Email?: string;
  Sch_EC_Teacher?: string;
  Sch_EC_Teacher_No?: string;
  Sch_EC_Teacher_Em?: string;
  Sch_Type?: string;
  Type?: string;
  Std_From?: string;
  Std_To?: string;
  Account_Name?: string;
  Account_No?: string;
  Bank?: string;
  Branch?: string;
  IFSC?: string;
  PFMS_Code?: string;
  File_ID?: string;
  File_Link?: string;
  Remarks?: string;
  EEP_Reg?: string;
  EEP_ID?: string;
  Timestamp?: string;
}

export interface UserRecord {
  id?: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

// ══════════════════════════════════════════════════════════════════
// 1. DATA SEEDING & MIGRATION INTO FIRESTORE
// ══════════════════════════════════════════════════════════════════
export async function seedFirestoreDatabase(): Promise<void> {
  const schoolsCol = collection(firestoreDb, 'schools');
  try {
    const existingSnap = await getDocs(schoolsCol);
    if (existingSnap.size > 0) {
      console.log(`[Firestore] 'schools' collection already populated with ${existingSnap.size} records.`);
      return;
    }

    console.log("[Firestore] Seeding schools collection into Firestore from SQLite/seed data (without UID)...");
    let rows: any[] = [];
    try {
      rows = sqliteDb.prepare('SELECT * FROM schools').all();
    } catch (e) {
      console.warn('[Firestore] Could not read SQLite schools for seeding, using fallback defaults.');
    }

    const batch = writeBatch(firestoreDb);
    let count = 0;

    for (const row of rows) {
      const docRef = doc(schoolsCol); // Auto-generated unique ID
      const schoolData: Record<string, any> = { ...row };

      // Strictly remove UID column as requested by the user
      delete schoolData.UID;
      delete schoolData.id;

      // Ensure '#' prefix for UDISE and Account_No
      if (schoolData.Sch_UDISE) {
        schoolData.Sch_UDISE = '#' + String(schoolData.Sch_UDISE).replace(/#/g, '').trim();
      }
      if (schoolData.Account_No) {
        schoolData.Account_No = '#' + String(schoolData.Account_No).replace(/#/g, '').trim();
      }
      if (!schoolData.Timestamp) {
        schoolData.Timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
      }

      batch.set(docRef, schoolData);
      count++;
    }

    if (count > 0) {
      await batch.commit();
      console.log(`[Firestore] Successfully seeded ${count} school documents into Firestore!`);
    }

    // Also check and seed users in Firestore
    const usersCol = collection(firestoreDb, 'users');
    const usersSnap = await getDocs(usersCol);
    if (usersSnap.size === 0) {
      const userBatch = writeBatch(firestoreDb);
      const userRows = sqliteDb.prepare('SELECT * FROM users').all() as any[];
      for (const u of userRows) {
        const uDoc = doc(usersCol);
        userBatch.set(uDoc, {
          username: u.username,
          password_hash: u.password_hash,
          role: u.role,
          created_at: u.created_at || new Date().toISOString()
        });
      }
      await userBatch.commit();
      console.log(`[Firestore] Seeded ${userRows.length} users into Firestore.`);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'schools');
  }
}

// ══════════════════════════════════════════════════════════════════
// 2. SCHOOL CRUD & UDISE UPSERT OPERATIONS
// ══════════════════════════════════════════════════════════════════

export async function getAllSchools(): Promise<SchoolRecord[]> {
  try {
    const colRef = collection(firestoreDb, 'schools');
    const snap = await getDocs(colRef);
    const schools: SchoolRecord[] = [];
    snap.forEach(docSnap => {
      const data = docSnap.data() as SchoolRecord;
      schools.push({
        ...data,
        id: docSnap.id
      });
    });
    return schools;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'schools');
  }
}

export async function getSchoolById(id: string): Promise<SchoolRecord | null> {
  const path = `schools/${id}`;
  try {
    const docRef = doc(firestoreDb, 'schools', id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return {
      ...(snap.data() as SchoolRecord),
      id: snap.id
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function getSchoolByUdise(rawUdise: string): Promise<SchoolRecord | null> {
  const cleanUdise = rawUdise.replace(/#/g, '').trim();
  const prefixedUdise = '#' + cleanUdise;

  try {
    const colRef = collection(firestoreDb, 'schools');

    // Query by prefixed UDISE
    const q1 = query(colRef, where('Sch_UDISE', '==', prefixedUdise), limit(1));
    const snap1 = await getDocs(q1);
    if (!snap1.empty) {
      const d = snap1.docs[0];
      return { ...(d.data() as SchoolRecord), id: d.id };
    }

    // Query by plain UDISE
    const q2 = query(colRef, where('Sch_UDISE', '==', cleanUdise), limit(1));
    const snap2 = await getDocs(q2);
    if (!snap2.empty) {
      const d = snap2.docs[0];
      return { ...(d.data() as SchoolRecord), id: d.id };
    }

    // Fallback: check all docs if not found
    const all = await getAllSchools();
    const found = all.find(s => {
      const u = (s.Sch_UDISE || '').replace(/#/g, '').trim();
      return u === cleanUdise;
    });
    return found || null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'schools');
  }
}

export async function upsertSchoolByUdise(rawUdise: string, incomingData: Partial<SchoolRecord>): Promise<{
  action: 'updated' | 'created';
  school: SchoolRecord;
  message: string;
}> {
  const cleanUdise = rawUdise.replace(/#/g, '').trim();
  const prefixedUdise = '#' + cleanUdise;

  try {
    const existing = await getSchoolByUdise(cleanUdise);
    const currentTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Standardize Account_No with '#' prefix
    let accountNo = incomingData.Account_No !== undefined && incomingData.Account_No !== null
      ? (String(incomingData.Account_No).trim() ? '#' + String(incomingData.Account_No).replace(/#/g, '').trim() : '')
      : (existing ? existing.Account_No : '');

    // Standardize numeric class standards
    const stdFrom = incomingData.Std_From !== undefined && incomingData.Std_From !== null && String(incomingData.Std_From).trim() !== ''
      ? String(incomingData.Std_From).replace(/^Class\s*/i, '').trim()
      : (existing ? existing.Std_From : '');

    const stdTo = incomingData.Std_To !== undefined && incomingData.Std_To !== null && String(incomingData.Std_To).trim() !== ''
      ? String(incomingData.Std_To).replace(/^Class\s*/i, '').trim()
      : (existing ? existing.Std_To : '');

    const schType = incomingData.Sch_Type || incomingData.Type || (existing ? (existing.Sch_Type || existing.Type) : 'Grant in Aid');

    if (existing && existing.id) {
      // ═════════════════════════════════════════════════════════════
      // UPDATE EXISTING FIRESTORE DOCUMENT
      // ═════════════════════════════════════════════════════════════
      const docRef = doc(firestoreDb, 'schools', existing.id);
      const updatePayload: Record<string, any> = {
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

      // Ensure UID is not present
      delete updatePayload.UID;
      delete updatePayload.id;

      await updateDoc(docRef, updatePayload);

      return {
        action: 'updated',
        school: { ...updatePayload, id: existing.id } as SchoolRecord,
        message: `School '${updatePayload.Sch_Name}' (UDISE: ${cleanUdise}) was successfully updated in Firestore SMDb.`
      };
    } else {
      // ═════════════════════════════════════════════════════════════
      // INSERT NEW FIRESTORE DOCUMENT (No UID field)
      // ═════════════════════════════════════════════════════════════
      const colRef = collection(firestoreDb, 'schools');
      const newDocRef = doc(colRef);

      const newRecord: Record<string, any> = {
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

      // Strictly ensure UID is not present
      delete newRecord.UID;
      delete newRecord.id;

      await setDoc(newDocRef, newRecord);

      return {
        action: 'created',
        school: { ...newRecord, id: newDocRef.id } as SchoolRecord,
        message: `New school '${newRecord.Sch_Name}' (UDISE: ${cleanUdise}) registered in Firestore SMDb with Document ID ${newDocRef.id}.`
      };
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'schools');
  }
}

export async function createSchool(data: Partial<SchoolRecord>): Promise<SchoolRecord> {
  try {
    const cleanUdise = (data.Sch_UDISE || '').replace(/#/g, '').trim();
    if (!cleanUdise) throw new Error('Sch_UDISE is required');

    const result = await upsertSchoolByUdise(cleanUdise, data);
    return result.school;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'schools');
  }
}

export async function updateSchool(id: string, data: Partial<SchoolRecord>): Promise<SchoolRecord> {
  const path = `schools/${id}`;
  try {
    const docRef = doc(firestoreDb, 'schools', id);
    const existing = await getDoc(docRef);
    if (!existing.exists()) {
      throw new Error(`School with ID ${id} not found`);
    }

    const currentTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const updateData: Record<string, any> = { ...data, Timestamp: currentTimestamp };

    // Strictly remove UID
    delete updateData.UID;
    delete updateData.id;

    if (updateData.Sch_UDISE) {
      updateData.Sch_UDISE = '#' + String(updateData.Sch_UDISE).replace(/#/g, '').trim();
    }
    if (updateData.Account_No) {
      updateData.Account_No = '#' + String(updateData.Account_No).replace(/#/g, '').trim();
    }

    await updateDoc(docRef, updateData);
    return {
      ...(existing.data() as SchoolRecord),
      ...updateData,
      id
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteSchool(id: string): Promise<boolean> {
  const path = `schools/${id}`;
  try {
    const docRef = doc(firestoreDb, 'schools', id);
    await deleteDoc(docRef);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ══════════════════════════════════════════════════════════════════
// 3. USER MANAGEMENT IN FIRESTORE
// ══════════════════════════════════════════════════════════════════

export async function getAllUsers(): Promise<UserRecord[]> {
  try {
    const colRef = collection(firestoreDb, 'users');
    const snap = await getDocs(colRef);
    const users: UserRecord[] = [];
    snap.forEach(d => {
      const u = d.data() as UserRecord;
      users.push({ ...u, id: d.id });
    });
    return users;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}

export async function getUserByUsername(username: string): Promise<UserRecord | null> {
  try {
    const colRef = collection(firestoreDb, 'users');
    const q = query(colRef, where('username', '==', username), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { ...(d.data() as UserRecord), id: d.id };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'users');
  }
}

export async function createUserInFirestore(username: string, passwordHash: string, role: 'admin' | 'viewer'): Promise<UserRecord> {
  try {
    const existing = await getUserByUsername(username);
    if (existing) {
      throw new Error(`Username '${username}' is already taken.`);
    }

    const colRef = collection(firestoreDb, 'users');
    const newDoc = doc(colRef);
    const userData: UserRecord = {
      username,
      password_hash: passwordHash,
      role,
      created_at: new Date().toISOString()
    };

    await setDoc(newDoc, userData);
    return { ...userData, id: newDoc.id };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'users');
  }
}

export async function deleteUserInFirestore(id: string): Promise<boolean> {
  const path = `users/${id}`;
  try {
    const docRef = doc(firestoreDb, 'users', id);
    await deleteDoc(docRef);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
