import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import path from 'path';

// Path for SQLite database file
const dbPath = path.resolve(process.cwd(), 'smdb.sqlite');
export const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys for performance and integrity
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

export function initDatabase() {
  // 1. Create schools table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      UID TEXT UNIQUE,
      Sch_UDISE TEXT NOT NULL UNIQUE,
      Sch_Name TEXT NOT NULL,
      Sch_Address TEXT,
      Sch_District TEXT,
      Sch_Taluka TEXT,
      Sch_Place TEXT,
      Sch_Pincode TEXT,
      Sch_Email TEXT,
      Sch_Principal TEXT,
      Sch_Principal_No TEXT,
      Sch_Principal_Email TEXT,
      Sch_EC_Teacher TEXT,
      Sch_EC_Teacher_No TEXT,
      Sch_EC_Teacher_Em TEXT,
      Sch_Type TEXT,
      Type TEXT,
      Std_From TEXT,
      Std_To TEXT,
      Account_Name TEXT,
      Account_No TEXT,
      Bank TEXT,
      Branch TEXT,
      IFSC TEXT,
      PFMS_Code TEXT,
      File_ID TEXT,
      File_Link TEXT,
      Timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      Remarks TEXT,
      EEP_Reg TEXT,
      EEP_ID TEXT
    );
  `);

  // Ensure Sch_Type column exists for migration before index creation
  try {
    const tableInfo = db.prepare('PRAGMA table_info(schools)').all() as { name: string }[];
    const hasSchType = tableInfo.some(col => col.name === 'Sch_Type');
    if (!hasSchType) {
      db.exec('ALTER TABLE schools ADD COLUMN Sch_Type TEXT;');
    }
  } catch (e) {
    console.error('[DB] Migration error checking/adding Sch_Type:', e);
  }

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_schools_udise ON schools (Sch_UDISE);
    CREATE INDEX IF NOT EXISTS idx_schools_district ON schools (Sch_District);
    CREATE INDEX IF NOT EXISTS idx_schools_taluka ON schools (Sch_Taluka);
    CREATE INDEX IF NOT EXISTS idx_schools_name ON schools (Sch_Name);
    CREATE INDEX IF NOT EXISTS idx_schools_sch_type ON schools (Sch_Type);
  `);

  // 2. Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'viewer')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default admin and viewer if not exists
  const countUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (countUsers.count === 0) {
    const adminPasswordHash = bcrypt.hashSync('Password@123', 10);
    const viewerPasswordHash = bcrypt.hashSync('Viewer@123', 10);

    const insertUser = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
    insertUser.run('admin', adminPasswordHash, 'admin');
    insertUser.run('viewer', viewerPasswordHash, 'viewer');
    console.log('[DB] Pre-seeded default admin (admin / Password@123) and viewer (viewer / Viewer@123)');
  }

  // 3. Clear legacy Maharashtra sample data and re-seed Gujarat sample schools
  try {
    const mhCount = (db.prepare("SELECT COUNT(*) as count FROM schools WHERE Sch_UDISE LIKE '27%' OR UID LIKE 'SCH-MH%' OR Sch_District IN ('Pune', 'Mumbai', 'Thane', 'Solapur', 'Nashik', 'Nagpur', 'Kolhapur', 'Aurangabad')").get() as { count: number }).count;
    if (mhCount > 0) {
      db.exec("DELETE FROM schools WHERE Sch_UDISE LIKE '27%' OR UID LIKE 'SCH-MH%' OR Sch_District IN ('Pune', 'Mumbai', 'Thane', 'Solapur', 'Nashik', 'Nagpur', 'Kolhapur', 'Aurangabad');");
      console.log(`[DB] Cleared ${mhCount} legacy Maharashtra records.`);
    }
  } catch (e) {
    console.error('[DB] Error clearing old sample data:', e);
  }

  const countSchools = (db.prepare('SELECT COUNT(*) as count FROM schools').get() as { count: number }).count;
  if (countSchools === 0) {
    seedSchools();
  } else {
    // Migration: ensure Sch_Type, # prefixes, and numeric standards
    db.exec(`
      UPDATE schools SET Sch_Type = 'Grant in Aid' WHERE Sch_Type IS NULL OR Sch_Type = '';
      UPDATE schools SET Sch_UDISE = '#' || REPLACE(Sch_UDISE, '#', '') WHERE Sch_UDISE IS NOT NULL AND Sch_UDISE != '';
      UPDATE schools SET Account_No = '#' || REPLACE(Account_No, '#', '') WHERE Account_No IS NOT NULL AND Account_No != '';
      UPDATE schools SET Std_From = REPLACE(Std_From, 'Class ', '') WHERE Std_From LIKE 'Class %';
      UPDATE schools SET Std_To = REPLACE(Std_To, 'Class ', '') WHERE Std_To LIKE 'Class %';
    `);
  }
}

function seedSchools() {
  const insert = db.prepare(`
    INSERT INTO schools (
      UID, Sch_UDISE, Sch_Name, Sch_Address, Sch_District, Sch_Taluka, Sch_Place,
      Sch_Pincode, Sch_Email, Sch_Principal, Sch_Principal_No, Sch_Principal_Email,
      Sch_EC_Teacher, Sch_EC_Teacher_No, Sch_EC_Teacher_Em, Sch_Type, Type, Std_From, Std_To,
      Account_Name, Account_No, Bank, Branch, IFSC, PFMS_Code, File_ID, File_Link,
      Timestamp, Remarks, EEP_Reg, EEP_ID
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      CURRENT_TIMESTAMP, ?, ?, ?
    )
  `);

  const sampleSchools = [
    {
      UID: 'SCH-GJ-001',
      Sch_UDISE: '#24070101201',
      Sch_Name: 'Sheth C. N. Vidyalaya & Higher Secondary School',
      Sch_Address: 'Sheth C.N. Vidyavihar Campus, Ambawadi',
      Sch_District: 'AHMEDABAD',
      Sch_Taluka: 'AHMEDABAD CITY',
      Sch_Place: 'Ahmedabad',
      Sch_Pincode: '380006',
      Sch_Email: 'cn.vidyalaya@edu.gov.in',
      Sch_Principal: 'Dr. Rameshchandra S. Patel',
      Sch_Principal_No: '+91 98250 11456',
      Sch_Principal_Email: 'principal.cn@edu.gov.in',
      Sch_EC_Teacher: 'Smt. Bharati K. Dave',
      Sch_EC_Teacher_No: '+91 98250 99887',
      Sch_EC_Teacher_Em: 'bharati.dave@edu.gov.in',
      Sch_Type: 'Grant in Aid',
      Std_From: '5',
      Std_To: '12',
      Account_Name: 'Sheth CN Vidyalaya SMC General Fund',
      Account_No: '#30981245678',
      Bank: 'State Bank of India',
      Branch: 'Ambawadi Ahmedabad',
      IFSC: 'SBIN0002330',
      PFMS_Code: 'GJAH0001234',
      File_ID: 'DOC-SMDb-2026-001',
      File_Link: 'https://example.gov.in/docs/schools/24070101201.pdf',
      Remarks: 'Heritage institution known for academic excellence and arts campus.',
      EEP_Reg: 'EEP-REG-2024-101',
      EEP_ID: 'GJ-AH-EEP-01201'
    },
    {
      UID: 'SCH-GJ-002',
      Sch_UDISE: '#24220303402',
      Sch_Name: 'Government Model High School Sanand',
      Sch_Address: 'Near GIDC Industrial Estate, Sanand-Bavla Road',
      Sch_District: 'AHMEDABAD',
      Sch_Taluka: 'SANAND',
      Sch_Place: 'Sanand',
      Sch_Pincode: '382110',
      Sch_Email: 'gmhs.sanand@edu.gov.in',
      Sch_Principal: 'Shri Pravinbhai M. Solanki',
      Sch_Principal_No: '+91 98791 22334',
      Sch_Principal_Email: 'pravin.solanki@edu.gov.in',
      Sch_EC_Teacher: 'Shri Hiteshbhai N. Prajapati',
      Sch_EC_Teacher_No: '+91 98791 55667',
      Sch_EC_Teacher_Em: 'hitesh.prajapati@edu.gov.in',
      Sch_Type: 'Government',
      Std_From: '9',
      Std_To: '12',
      Account_Name: 'Govt Model High School Sanand SMC',
      Account_No: '#20193847561',
      Bank: 'Bank of Baroda',
      Branch: 'Sanand Main Branch',
      IFSC: 'BARB0SANAND',
      PFMS_Code: 'GJAH0004561',
      File_ID: 'DOC-SMDb-2026-002',
      File_Link: 'https://example.gov.in/docs/schools/24220303402.pdf',
      Remarks: 'Government smart school with modern science labs and digital classrooms.',
      EEP_Reg: 'EEP-REG-2024-205',
      EEP_ID: 'GJ-AH-EEP-03402'
    },
    {
      UID: 'SCH-GJ-003',
      Sch_UDISE: '#24220508903',
      Sch_Name: 'The Radiant International Public School',
      Sch_Address: 'Plot 12, Ring Road, Near Vesu Canal',
      Sch_District: 'SURAT',
      Sch_Taluka: 'SURAT (CITY)',
      Sch_Place: 'Surat',
      Sch_Pincode: '395007',
      Sch_Email: 'radiant.surat@edu.gov.in',
      Sch_Principal: 'Dr. Anita Roy',
      Sch_Principal_No: '+91 98240 55667',
      Sch_Principal_Email: 'principal@radiantschool.edu',
      Sch_EC_Teacher: 'Mr. Kaushik Shah',
      Sch_EC_Teacher_No: '+91 98240 88990',
      Sch_EC_Teacher_Em: 'kaushik.shah@radiantschool.edu',
      Sch_Type: 'Private',
      Std_From: '1',
      Std_To: '12',
      Account_Name: 'Radiant Education Trust Fund',
      Account_No: '#40192837465',
      Bank: 'HDFC Bank',
      Branch: 'Vesu Surat',
      IFSC: 'HDFC0001024',
      PFMS_Code: 'GJSR0007821',
      File_ID: 'DOC-SMDb-2026-003',
      File_Link: 'https://example.gov.in/docs/schools/24220508903.pdf',
      Remarks: 'Self-financed CBSE affiliated institution with athletic facilities.',
      EEP_Reg: 'EEP-REG-2024-412',
      EEP_ID: 'GJ-SR-EEP-08903'
    },
    {
      UID: 'SCH-GJ-004',
      Sch_UDISE: '#24190102104',
      Sch_Name: 'Navrachana Higher Secondary Vidyalaya',
      Sch_Address: 'Sama Road, Opp. Mehsana Nagar Ground',
      Sch_District: 'VADODARA',
      Sch_Taluka: 'VADODARA',
      Sch_Place: 'Vadodara',
      Sch_Pincode: '390024',
      Sch_Email: 'navrachana.sama@edu.gov.in',
      Sch_Principal: 'Smt. Tejalben R. Amin',
      Sch_Principal_No: '+91 98255 12345',
      Sch_Principal_Email: 'tejal.amin@edu.gov.in',
      Sch_EC_Teacher: 'Shri Nileshbhai J. Joshi',
      Sch_EC_Teacher_No: '+91 98255 67890',
      Sch_EC_Teacher_Em: 'nilesh.joshi@edu.gov.in',
      Sch_Type: 'Grant in Aid',
      Std_From: '1',
      Std_To: '12',
      Account_Name: 'Navrachana Education Society Account',
      Account_No: '#10928374650',
      Bank: 'State Bank of India',
      Branch: 'Karelibaug Vadodara',
      IFSC: 'SBIN0003310',
      PFMS_Code: 'GJVD0003120',
      File_ID: 'DOC-SMDb-2026-004',
      File_Link: 'https://example.gov.in/docs/schools/24190102104.pdf',
      Remarks: 'Pioneer in progressive pedagogy, inclusive learning and performing arts.',
      EEP_Reg: 'EEP-REG-2024-523',
      EEP_ID: 'GJ-VD-EEP-02104'
    },
    {
      UID: 'SCH-GJ-005',
      Sch_UDISE: '#24090204505',
      Sch_Name: 'Shree Vallabh Kanya Kelavani Mandal High School',
      Sch_Address: 'Dhebar Road, Near Trikon Baug',
      Sch_District: 'RAJKOT',
      Sch_Taluka: 'RAJKOT',
      Sch_Place: 'Rajkot',
      Sch_Pincode: '360001',
      Sch_Email: 'svkm.rajkot@edu.gov.in',
      Sch_Principal: 'Smt. Jyotiben G. Vora',
      Sch_Principal_No: '+91 94280 44556',
      Sch_Principal_Email: 'jyoti.vora@edu.gov.in',
      Sch_EC_Teacher: 'Ms. Chetna M. Rathod',
      Sch_EC_Teacher_No: '+91 94280 11223',
      Sch_EC_Teacher_Em: 'chetna.rathod@edu.gov.in',
      Sch_Type: 'Grant in Aid',
      Std_From: '5',
      Std_To: '10',
      Account_Name: 'SVKM High School Rajkot Fund',
      Account_No: '#50192837461',
      Bank: 'Bank of India',
      Branch: 'Dhebar Road Rajkot',
      IFSC: 'BKID0002101',
      PFMS_Code: 'GJRJ0006789',
      File_ID: 'DOC-SMDb-2026-005',
      File_Link: 'https://example.gov.in/docs/schools/24090204505.pdf',
      Remarks: 'Eminent girls high school empowering students across Saurashtra region.',
      EEP_Reg: 'EEP-REG-2024-634',
      EEP_ID: 'GJ-RJ-EEP-04505'
    },
    {
      UID: 'SCH-GJ-006',
      Sch_UDISE: '#24180401806',
      Sch_Name: 'Government Secondary School Kalol',
      Sch_Address: 'Sector 2, Near Ambaji Temple, Kalol Highway',
      Sch_District: 'GANDHINAGAR',
      Sch_Taluka: 'KALOL',
      Sch_Place: 'Kalol',
      Sch_Pincode: '382721',
      Sch_Email: 'gss.kalol@edu.gov.in',
      Sch_Principal: 'Shri Vikramsinh D. Vaghela',
      Sch_Principal_No: '+91 98251 77889',
      Sch_Principal_Email: 'vikram.vaghela@edu.gov.in',
      Sch_EC_Teacher: 'Shri Bharatkumar S. Patel',
      Sch_EC_Teacher_No: '+91 98251 33445',
      Sch_EC_Teacher_Em: 'bharat.patel@edu.gov.in',
      Sch_Type: 'Government',
      Std_From: '6',
      Std_To: '10',
      Account_Name: 'Government Secondary School Kalol SMC',
      Account_No: '#60192837452',
      Bank: 'State Bank of India',
      Branch: 'Kalol Town',
      IFSC: 'SBIN0000402',
      PFMS_Code: 'GJGN0001890',
      File_ID: 'DOC-SMDb-2026-006',
      File_Link: 'https://example.gov.in/docs/schools/24180401806.pdf',
      Remarks: 'Government school with strong vocational tailoring and computer literacy programs.',
      EEP_Reg: 'EEP-REG-2024-745',
      EEP_ID: 'GJ-GN-EEP-01806'
    },
    {
      UID: 'SCH-GJ-007',
      Sch_UDISE: '#24200103107',
      Sch_Name: 'Alfred High School (Mohandas Gandhi High School)',
      Sch_Address: 'Jubilee Garden, Rajkot City Centre',
      Sch_District: 'RAJKOT',
      Sch_Taluka: 'RAJKOT',
      Sch_Place: 'Rajkot',
      Sch_Pincode: '360001',
      Sch_Email: 'alfred.highschool@edu.gov.in',
      Sch_Principal: 'Dr. Jayeshbhai K. Bhatt',
      Sch_Principal_No: '+91 94272 88990',
      Sch_Principal_Email: 'jayesh.bhatt@edu.gov.in',
      Sch_EC_Teacher: 'Smt. Dimple N. Trivedi',
      Sch_EC_Teacher_No: '+91 94272 44556',
      Sch_EC_Teacher_Em: 'dimple.trivedi@edu.gov.in',
      Sch_Type: 'Government',
      Std_From: '9',
      Std_To: '12',
      Account_Name: 'Alfred High School SMC Maintenance Fund',
      Account_No: '#70192837443',
      Bank: 'Punjab National Bank',
      Branch: 'Jubilee Chowk Rajkot',
      IFSC: 'PUNB0039200',
      PFMS_Code: 'GJRJ0003412',
      File_ID: 'DOC-SMDb-2026-007',
      File_Link: 'https://example.gov.in/docs/schools/24200103107.pdf',
      Remarks: 'Historic national heritage school with Mahatma Gandhi museum wing.',
      EEP_Reg: 'EEP-REG-2024-856',
      EEP_ID: 'GJ-RJ-EEP-03107'
    },
    {
      UID: 'SCH-GJ-008',
      Sch_UDISE: '#24110301908',
      Sch_Name: 'St. Xavier\'s High School Mirzapur',
      Sch_Address: 'Near Electricity House, Mirzapur Road',
      Sch_District: 'AHMEDABAD',
      Sch_Taluka: 'AHMEDABAD CITY',
      Sch_Place: 'Ahmedabad',
      Sch_Pincode: '380001',
      Sch_Email: 'xavier.mirzapur@edu.gov.in',
      Sch_Principal: 'Fr. Robert Fernandes S.J.',
      Sch_Principal_No: '+91 98254 33221',
      Sch_Principal_Email: 'principal.xavier@edu.gov.in',
      Sch_EC_Teacher: 'Mr. Dominic D\'Souza',
      Sch_EC_Teacher_No: '+91 98254 77665',
      Sch_EC_Teacher_Em: 'dominic.dsouza@edu.gov.in',
      Sch_Type: 'Private',
      Std_From: '1',
      Std_To: '12',
      Account_Name: 'Gujarat Jesuit Schools Society St Xaviers',
      Account_No: '#80192837434',
      Bank: 'Axis Bank',
      Branch: 'Ellisbridge Ahmedabad',
      IFSC: 'UTIB0000032',
      PFMS_Code: 'GJAH0005521',
      File_ID: 'DOC-SMDb-2026-008',
      File_Link: 'https://example.gov.in/docs/schools/24110301908.pdf',
      Remarks: 'Renowned minority private institution with comprehensive sports facilities.',
      EEP_Reg: 'EEP-REG-2024-967',
      EEP_ID: 'GJ-AH-EEP-01908'
    },
    {
      UID: 'SCH-GJ-009',
      Sch_UDISE: '#24140201509',
      Sch_Name: 'D.N. High School Anand',
      Sch_Address: 'Station Road, Opp. Town Hall',
      Sch_District: 'ANAND',
      Sch_Taluka: 'ANAND',
      Sch_Place: 'Anand',
      Sch_Pincode: '388001',
      Sch_Email: 'dnhighschool.anand@edu.gov.in',
      Sch_Principal: 'Shri Jagdishbhai B. Patel',
      Sch_Principal_No: '+91 98256 99112',
      Sch_Principal_Email: 'jagdish.patel@edu.gov.in',
      Sch_EC_Teacher: 'Shri Kamleshkumar M. Shah',
      Sch_EC_Teacher_No: '+91 98256 66554',
      Sch_EC_Teacher_Em: 'kamlesh.shah@edu.gov.in',
      Sch_Type: 'Grant in Aid',
      Std_From: '5',
      Std_To: '12',
      Account_Name: 'Charutar Vidyamandal DN High School',
      Account_No: '#45678901234',
      Bank: 'Bank of Baroda',
      Branch: 'Anand Main',
      IFSC: 'BARB0ANANDX',
      PFMS_Code: 'GJAN0002134',
      File_ID: 'DOC-SMDb-2026-009',
      File_Link: 'https://example.gov.in/docs/schools/24140201509.pdf',
      Remarks: 'Prominent educational institution managed by Charutar Vidya Mandal.',
      EEP_Reg: 'EEP-REG-2024-911',
      EEP_ID: 'GJ-AN-EEP-01509'
    },
    {
      UID: 'SCH-GJ-010',
      Sch_UDISE: '#24150502410',
      Sch_Name: 'Shri B. M. High School Bhavnagar',
      Sch_Address: 'Kalanala, Bhavnagar City Centre',
      Sch_District: 'BHAVNAGAR',
      Sch_Taluka: 'BHAVNAGAR',
      Sch_Place: 'Bhavnagar',
      Sch_Pincode: '364001',
      Sch_Email: 'bmhighschool.bhav@edu.gov.in',
      Sch_Principal: 'Mrs. Jayaben M. Mehta',
      Sch_Principal_No: '+91 98257 77112',
      Sch_Principal_Email: 'jayaben.mehta@edu.gov.in',
      Sch_EC_Teacher: 'Mr. Pareshbhai K. Joshi',
      Sch_EC_Teacher_No: '+91 98257 44889',
      Sch_EC_Teacher_Em: 'paresh.joshi@edu.gov.in',
      Sch_Type: 'Grant in Aid',
      Std_From: '5',
      Std_To: '12',
      Account_Name: 'Shri BM High School Educational Trust',
      Account_No: '#56789012345',
      Bank: 'State Bank of India',
      Branch: 'Kalanala Bhavnagar',
      IFSC: 'SBIN0000332',
      PFMS_Code: 'GJBH0009841',
      File_ID: 'DOC-SMDb-2026-010',
      File_Link: 'https://example.gov.in/docs/schools/24150502410.pdf',
      Remarks: 'Historic Grant in Aid institution known for merit ranks in board exams.',
      EEP_Reg: 'EEP-REG-2024-955',
      EEP_ID: 'GJ-BH-EEP-02410'
    }
  ];

  for (const s of sampleSchools) {
    insert.run(
      s.UID,
      s.Sch_UDISE,
      s.Sch_Name,
      s.Sch_Address,
      s.Sch_District,
      s.Sch_Taluka,
      s.Sch_Place,
      s.Sch_Pincode,
      s.Sch_Email,
      s.Sch_Principal,
      s.Sch_Principal_No,
      s.Sch_Principal_Email,
      s.Sch_EC_Teacher,
      s.Sch_EC_Teacher_No,
      s.Sch_EC_Teacher_Em,
      s.Sch_Type,
      s.Sch_Type,
      s.Std_From,
      s.Std_To,
      s.Account_Name,
      s.Account_No,
      s.Bank,
      s.Branch,
      s.IFSC,
      s.PFMS_Code,
      s.File_ID,
      s.File_Link,
      s.Remarks,
      s.EEP_Reg,
      s.EEP_ID
    );
  }
  console.log(`[DB] Pre-seeded ${sampleSchools.length} Gujarat school records.`);
}
