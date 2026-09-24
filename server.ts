import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  getAllSchools,
  getSchoolById,
  getSchoolByUdise,
  upsertSchoolByUdise,
  createSchool,
  updateSchool,
  deleteSchool,
  seedFirestoreDatabase,
  getUserByUsername,
  createUserInFirestore,
  deleteUserInFirestore,
  getAllUsers,
  SchoolRecord,
  UserRecord
} from './src/firestore-service.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firestore DB schema & pre-seed
seedFirestoreDatabase().catch(err => {
  console.warn('[Firestore] Initialization error (may be offline during build):', err.message);
});

// Load Districts and Talukas Resource
const districtsTalukasPath = path.resolve(process.cwd(), 'src/data/districts_talukas.json');
let districtsTalukasData: Record<string, string[]> = {};
try {
  districtsTalukasData = JSON.parse(fs.readFileSync(districtsTalukasPath, 'utf-8'));
} catch (e) {
  console.error('[Resource] Could not load districts_talukas.json:', e);
}

const app = express();
// AI Studio dev server runs on port 3000. In production Cloud Run, use PORT or 8080.
const PORT = process.env.NODE_ENV === 'production' ? Number(process.env.PORT || 8080) : 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'smdb-secure-master-school-secret-key-2026';

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Custom auth user type
interface AuthUser {
  id?: string;
  username: string;
  role: 'admin' | 'viewer';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser | null;
    }
  }
}

// Token Verification Middleware
function extractUser(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (!token && req.cookies && req.cookies.smdb_token) {
    token = req.cookies.smdb_token;
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
  } catch (err) {
    req.user = null;
  }
  next();
}

app.use(extractUser);

// Admin-only guard middleware
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({
      error: 'Permission denied. Only administrator accounts can perform this action.'
    });
    return;
  }
  next();
}

// ==========================================
// 1. AUTHENTICATION & USER MANAGEMENT (FIRESTORE)
// ==========================================

// Login
app.post('/api/auth/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  try {
    const user = await getUserByUsername(username);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('smdb_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      },
      message: `Welcome back, ${user.username}!`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Authentication failed' });
  }
});

// Current User Info
app.get('/api/auth/me', (req: Request, res: Response): void => {
  if (!req.user) {
    res.json({ user: null, role: 'guest' });
    return;
  }
  res.json({ user: req.user, role: req.user.role });
});

// Logout
app.post('/api/auth/logout', (req: Request, res: Response): void => {
  res.clearCookie('smdb_token');
  res.json({ success: true, message: 'Logged out successfully.' });
});

// Get User List (Admin Only)
app.get('/api/users', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await getAllUsers();
    const safeUsers = users.map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      created_at: u.created_at
    }));
    res.json({ users: safeUsers });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch users' });
  }
});

// Create User (Admin Only)
app.post('/api/users', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    res.status(400).json({ error: 'Username, password, and role are required.' });
    return;
  }

  if (role !== 'admin' && role !== 'viewer') {
    res.status(400).json({ error: "Role must be either 'admin' or 'viewer'." });
    return;
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const createdUser = await createUserInFirestore(username, passwordHash, role);

    res.status(201).json({
      success: true,
      user: {
        id: createdUser.id,
        username: createdUser.username,
        role: createdUser.role
      },
      message: `User '${username}' created successfully.`
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create user' });
  }
});

// Delete User (Admin Only)
app.delete('/api/users/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const targetId = req.params.id;
  if (!targetId) {
    res.status(400).json({ error: 'Invalid user ID.' });
    return;
  }

  if (req.user && req.user.id === targetId) {
    res.status(400).json({ error: 'You cannot delete your own account.' });
    return;
  }

  try {
    const users = await getAllUsers();
    const targetUser = users.find(u => u.id === targetId);

    if (!targetUser) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (targetUser.username === 'admin') {
      res.status(400).json({ error: 'Cannot delete the primary system administrator account.' });
      return;
    }

    await deleteUserInFirestore(targetId);
    res.json({ success: true, message: `User '${targetUser.username}' deleted successfully.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete user' });
  }
});

// ==========================================
// 2. PUBLIC / DEDICATED UDISE LOOKUP API (FIRESTORE)
// ==========================================

// OPTIONS Preflight for public UDISE lookup and sync endpoints
app.options(['/api/schools/udise/:udise_code', '/api/schools/sync'], (req: Request, res: Response): void => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.sendStatus(204);
});

// GET /api/schools/udise/:udise_code - Public UDISE lookup endpoint (CORS enabled)
app.get('/api/schools/udise/:udise_code', async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

  const rawUdise = req.params.udise_code?.trim();
  if (!rawUdise) {
    res.status(400).json({ error: 'UDISE code parameter is required.' });
    return;
  }

  const cleanUdise = rawUdise.replace(/#/g, '').trim();

  try {
    const school = await getSchoolByUdise(cleanUdise);
    if (!school) {
      res.status(404).json({
        error: 'School not found with specified UDISE code.',
        udise: cleanUdise
      });
      return;
    }

    // Ensure UID is not sent
    const { UID, ...safeSchool } = school as any;
    res.json(safeSchool);
  } catch (err: any) {
    console.error('Error in UDISE lookup:', err);
    res.status(500).json({ error: err.message || 'Error looking up school' });
  }
});

// Helper function: Upsert (Insert or Update) school by UDISE and update Timestamp
async function handleUdiseUpsert(req: Request, res: Response): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

  const rawUdise = (req.params.udise_code || req.body?.Sch_UDISE || req.body?.udise || '').toString().trim();
  if (!rawUdise) {
    res.status(400).json({ error: 'UDISE code is required either in the URL path or request body (Sch_UDISE).' });
    return;
  }

  const cleanUdise = rawUdise.replace(/#/g, '').trim();
  const data = req.body || {};

  try {
    const result = await upsertSchoolByUdise(cleanUdise, data);
    const { UID, ...safeSchool } = result.school as any;

    res.json({
      success: true,
      action: result.action,
      message: result.message,
      timestamp: safeSchool.Timestamp,
      data: safeSchool
    });
  } catch (err: any) {
    console.error('Error upserting school by UDISE:', err);
    res.status(500).json({ error: err.message || 'Failed to sync school data.' });
  }
}

// POST & PUT /api/schools/udise/:udise_code - Sync / Upsert school by UDISE with timestamp
app.post('/api/schools/udise/:udise_code', handleUdiseUpsert);
app.put('/api/schools/udise/:udise_code', handleUdiseUpsert);

// POST /api/schools/sync - Sync / Upsert school passing Sch_UDISE in request body
app.post('/api/schools/sync', handleUdiseUpsert);

// ==========================================
// 3. SCHOOLS CRUD & TABULATOR PROGRESSIVE API (FIRESTORE)
// ==========================================

// GET /api/schools - List view with Tabulator serverside pagination, sorting & filtering
app.get('/api/schools', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const isAll = req.query.size === 'true' || req.query.size === 'all' || req.query.size === '0';
    const size = isAll ? 10000 : Math.min(500, Math.max(1, parseInt(req.query.size as string, 10) || 10));

    const globalSearch = (req.query.search as string || '').trim().toLowerCase();
    const districtFilter = (req.query.district as string || '').trim().toLowerCase();
    const talukaFilter = (req.query.taluka as string || '').trim().toLowerCase();
    const typeFilter = (req.query.type as string || req.query.sch_type as string || '').trim().toLowerCase();

    // Fetch all schools from Firestore
    let allSchools = await getAllSchools();

    // Filter out UID if present
    allSchools = allSchools.map(s => {
      const { UID, ...rest } = s as any;
      return rest;
    });

    // 1. Apply Global Search
    if (globalSearch) {
      const cleanSearch = globalSearch.replace(/#/g, '');
      allSchools = allSchools.filter(s => {
        return Object.entries(s).some(([key, val]) => {
          if (val === null || val === undefined) return false;
          const str = String(val).toLowerCase();
          const cleanStr = str.replace(/#/g, '');
          return str.includes(globalSearch) || cleanStr.includes(cleanSearch);
        });
      });
    }

    // 2. Apply District Filter
    if (districtFilter) {
      allSchools = allSchools.filter(s =>
        (s.Sch_District || '').toLowerCase() === districtFilter
      );
    }

    // 3. Apply Taluka Filter
    if (talukaFilter) {
      allSchools = allSchools.filter(s =>
        (s.Sch_Taluka || '').toLowerCase() === talukaFilter
      );
    }

    // 4. Apply School Type Filter
    if (typeFilter) {
      allSchools = allSchools.filter(s => {
        const t = (s.Sch_Type || s.Type || '').toLowerCase();
        return t === typeFilter;
      });
    }

    // 5. Apply Column Filters (from Tabulator header filters)
    let rawFilters: any[] = [];
    const qFilter = req.query.filter || req.query.filters;
    if (typeof qFilter === 'string') {
      try {
        const parsed = JSON.parse(qFilter);
        if (Array.isArray(parsed)) rawFilters = parsed;
      } catch (e) {
        // Not a JSON string
      }
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

      allSchools = allSchools.filter(s => {
        const recordVal = (s as any)[field];
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

    if (req.query.sort) {
      sortField = req.query.sort as string;
    } else if (req.query.sorters) {
      const sorters = req.query.sorters as any;
      if (Array.isArray(sorters) && sorters.length > 0 && sorters[0]?.field) {
        sortField = sorters[0].field;
        sortDir = sorters[0].dir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      }
    }

    if (req.query.dir) {
      sortDir = (req.query.dir as string).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    }

    allSchools.sort((a: any, b: any) => {
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

    const total = allSchools.length;
    const lastPage = Math.ceil(total / size) || 1;
    const offset = (page - 1) * size;
    const pagedRows = allSchools.slice(offset, offset + size);

    res.json({
      last_page: lastPage,
      last_row: total,
      page,
      size,
      total,
      data: pagedRows
    });
  } catch (error: any) {
    console.error('Error fetching schools:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch schools' });
  }
});

// GET /api/schools/export/all - Full export endpoint for Excel/CSV
app.get('/api/schools/export/all', async (req: Request, res: Response): Promise<void> => {
  try {
    const schools = await getAllSchools();
    const cleanSchools = schools.map(s => {
      const { UID, ...rest } = s as any;
      return rest;
    });
    res.json({ data: cleanSchools });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to export schools' });
  }
});

// GET /api/schools/meta/filters - District and Taluka lists for select dropdowns
app.get('/api/schools/meta/filters', async (req: Request, res: Response): Promise<void> => {
  try {
    const resourceDistricts = Object.keys(districtsTalukasData).sort();
    const schools = await getAllSchools();
    const dbDistricts = schools.map(s => s.Sch_District).filter(Boolean) as string[];

    const allDistrictsSet = new Set<string>([...resourceDistricts, ...dbDistricts]);
    const districts = Array.from(allDistrictsSet).sort();
    const types = ['Grant in Aid', 'Government', 'Private'];

    res.json({
      districts,
      types,
      schTypes: types,
      talukasMap: districtsTalukasData
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load metadata' });
  }
});

// GET /api/schools/meta/districts-talukas - Raw dictionary resource
app.get('/api/schools/meta/districts-talukas', (req: Request, res: Response): void => {
  res.json(districtsTalukasData);
});

// GET /api/stats - Dashboard metrics
app.get('/api/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const schools = await getAllSchools();
    const totalSchools = schools.length;
    const totalDistricts = new Set(schools.map(s => s.Sch_District).filter(Boolean)).size;

    const grantInAidCount = schools.filter(s => (s.Sch_Type || s.Type) === 'Grant in Aid').length;
    const governmentCount = schools.filter(s => (s.Sch_Type || s.Type) === 'Government').length;
    const privateCount = schools.filter(s => (s.Sch_Type || s.Type) === 'Private').length;

    res.json({
      totalSchools,
      totalDistricts,
      grantInAidCount,
      governmentCount,
      privateCount,
      higherSecCount: grantInAidCount,
      primarySecCount: governmentCount
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load stats' });
  }
});

// GET /api/schools/:id - Single school detail view
app.get('/api/schools/:id', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'School ID is required.' });
    return;
  }

  try {
    const school = await getSchoolById(id);
    if (!school) {
      res.status(404).json({ error: 'School record not found.' });
      return;
    }

    const { UID, ...safeSchool } = school as any;
    res.json(safeSchool);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error fetching school' });
  }
});

// POST /api/schools - Add school (Admin Only)
app.post('/api/schools', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const data = req.body;

  if (!data.Sch_UDISE || !data.Sch_UDISE.trim()) {
    res.status(400).json({ error: 'School UDISE code (Sch_UDISE) is required.' });
    return;
  }

  if (!data.Sch_Name || !data.Sch_Name.trim()) {
    res.status(400).json({ error: 'School Name (Sch_Name) is required.' });
    return;
  }

  try {
    const cleanUdise = data.Sch_UDISE.replace(/#/g, '').trim();
    const existing = await getSchoolByUdise(cleanUdise);
    if (existing) {
      res.status(409).json({ error: `A school with UDISE code '${cleanUdise}' already exists in SMDb.` });
      return;
    }

    const newRecord = await createSchool(data);
    const { UID, ...safeRecord } = newRecord as any;

    res.status(201).json({
      success: true,
      data: safeRecord,
      message: `School '${data.Sch_Name}' registered successfully with UDISE #${cleanUdise}.`
    });
  } catch (error: any) {
    console.error('Error inserting school:', error);
    res.status(500).json({ error: error.message || 'Failed to save school record.' });
  }
});

// PUT /api/schools/:id - Edit school (Admin Only)
app.put('/api/schools/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'Invalid school ID.' });
    return;
  }

  try {
    const existing = await getSchoolById(id);
    if (!existing) {
      res.status(404).json({ error: 'School record not found.' });
      return;
    }

    const data = req.body;
    if (!data.Sch_UDISE || !data.Sch_UDISE.trim()) {
      res.status(400).json({ error: 'School UDISE code is required.' });
      return;
    }

    if (!data.Sch_Name || !data.Sch_Name.trim()) {
      res.status(400).json({ error: 'School Name is required.' });
      return;
    }

    const cleanUdise = data.Sch_UDISE.replace(/#/g, '').trim();
    const existingUdiseSchool = await getSchoolByUdise(cleanUdise);
    if (existingUdiseSchool && existingUdiseSchool.id !== id) {
      res.status(409).json({ error: `UDISE code '${cleanUdise}' is already assigned to another school record.` });
      return;
    }

    const updated = await updateSchool(id, data);
    const { UID, ...safeUpdated } = updated as any;

    res.json({
      success: true,
      data: safeUpdated,
      message: `School '${data.Sch_Name}' updated successfully in Firestore.`
    });
  } catch (error: any) {
    console.error('Error updating school:', error);
    res.status(500).json({ error: error.message || 'Failed to update school record.' });
  }
});

// DELETE /api/schools/:id - Delete school (Admin Only)
app.delete('/api/schools/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'Invalid school ID.' });
    return;
  }

  try {
    const existing = await getSchoolById(id);
    if (!existing) {
      res.status(404).json({ error: 'School record not found.' });
      return;
    }

    await deleteSchool(id);

    res.json({
      success: true,
      message: `School '${existing.Sch_Name}' (UDISE: ${existing.Sch_UDISE}) was permanently deleted from Firestore.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete school record.' });
  }
});

// ==========================================
// 4. FRONTEND DEV & PROD SERVING SETUP
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    // In Dev mode, mount Vite middleware to serve client SPA & assets
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, () => {
    console.log(`[SMDb Firestore Server] Running on http://localhost:${PORT}`);
  });
}

startServer();
