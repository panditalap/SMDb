# SMDb - School Master Database

A high-performance, responsive Master School Directory and Administration platform built with **Node.js, Express, TypeScript, Firebase Firestore, Tabulator Tables, and Bootstrap 5**.

SMDb provides centralized school data management, progressive server-side pagination, real-time analytics, role-based access control (RBAC), and a dedicated cross-origin (CORS) **UDISE Lookup & Sync REST API** designed for integration into external education portals.

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Demo-success?logo=github)](https://panditalap.github.io/SMDb/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Firebase Firestore](https://img.shields.io/badge/Database-Firebase%20Firestore-orange?logo=firebase)](https://firebase.google.com/)
[![Tabulator](https://img.shields.io/badge/DataGrid-Tabulator%206.2-brightgreen)](https://tabulator.info/)

---

## 📋 Table of Contents

- [Key Highlights](#-key-highlights)
- [Architecture & Dual-Mode Hosting](#-architecture--dual-mode-hosting)
- [Application Pages](#-application-pages)
  - [1. School Master Data Grid](#1-page-1-school-master-data-grid)
  - [2. UDISE Lookup API & Integration Sandbox](#2-page-2-udise-lookup-api--integration-sandbox)
  - [3. User Management & RBAC](#3-page-3-user-management--rbac)
  - [4. External Client Simulation Demo](#4-external-client-simulation-demo)
- [REST API Reference](#-rest-api-reference)
- [Data Model & Schema](#-data-model--schema)
- [Default Credentials](#-default-credentials)
- [Project Structure](#-project-structure)
- [Getting Started (Local Development)](#-getting-started-local-development)
- [GitHub Pages Deployment Guide](#-github-pages-deployment-guide)
- [Environment Variables](#-environment-variables)
- [License](#-license)

---

## 🌟 Key Highlights

- **Dual-Mode Execution**:
  - **Full-Stack Mode**: Node.js + Express backend with JWT session authentication, REST endpoints, and Firestore database integration.
  - **Static Host Mode (GitHub Pages)**: Pure client-side operation with direct, secure Firebase Firestore connection, client-side pagination, and real-time live metric recalculation.
- **Progressive Data Grid**: Tabulator 6.2 table with server/client pagination, column-specific filters, global search, and instant Excel / CSV export.
- **Cascading Administrative Filters**: Dynamic District ➔ Taluka cascading dropdowns based on Gujarat state administrative geography.
- **External Integration API**: Public, CORS-enabled endpoints (`GET /api/schools/udise/:code` and `POST /api/schools/sync`) for instant school auto-population in external web forms.
- **UDISE-First Architecture**: Standardized around the official 11-digit national `Sch_UDISE` identifier; internal database IDs (`UID`) are omitted from client exposure.
- **Role-Based Access Control**: Granular permissions distinguishing administrative staff (CRUD, sync, user management) from viewers (read-only search, export, API testing).

---

## 🏛 Architecture & Dual-Mode Hosting

```
                  ┌───────────────────────────────────────────┐
                  │          Browser / Client Device          │
                  └─────┬───────────────────────────────┬─────┘
                        │                               │
       Full-Stack Mode  │                               │  Static Host Mode
      (Local / Cloud)   │                               │  (GitHub Pages)
                        ▼                               ▼
       ┌────────────────────────────────┐     ┌─────────────────────────────────┐
       │   Express + Node.js Backend    │     │   Client-Side Firestore Client  │
       │    - JWT Authentication        │     │   (src/client-firebase.js)      │
       │    - CORS REST API Endpoints   │     │   - Direct Firestore Queries    │
       │    - Server Pagination/Sorting │     │   - In-Memory Analytics         │
       └────────────────┬───────────────┘     └─────────────────┬───────────────┘
                        │                                       │
                        └───────────────────┬───────────────────┘
                                            │
                                            ▼
                             ┌─────────────────────────────┐
                             │  Google Firebase Firestore  │
                             │  - `schools` collection     │
                             │  - `users` collection       │
                             │  - `firestore.rules`        │
                             └─────────────────────────────┘
```

When hosted on **GitHub Pages** (`https://panditalap.github.io/SMDb/`):
- The app automatically detects the static hosting environment.
- Asset URLs resolve relatively (`./src/index.css`, `./src/app.js`).
- Database reads, writes, searches, and metric aggregations route directly through Firebase Firestore SDK (`v12`).

When hosted on **Node.js / Cloud Run / AI Studio**:
- Express serves the API on `/api/*` and Vite serves the client application.
- API requests use fast server-side aggregation and caching.

---

## 🖥 Application Pages

### 1. Page 1: School Master Data Grid
- **Live Summary Metrics**: Real-time KPI counters showing Total Schools, Districts Covered, Grant-in-Aid, and Government institutions.
- **Data Table**: Tabulator 6.2 with progressive page loading (10, 25, 50, 100, or All records), column sorting, and responsive column resizing.
- **Search & Filters**:
  - Global text search across all columns.
  - Cascading District and Taluka dropdown selectors.
  - School category selector (Grant in Aid, Government, Private).
  - Per-column header filters for UDISE, School Name, Village/Place, Bank Account, Standards, etc.
- **School Administration (Admin Only)**:
  - **Add New School**: Comprehensive modal with tabbed sections (Basic Details, Address & Taluka, Contacts, Bank & PFMS, Administrative / Drive links).
  - **Edit School**: Pre-populated modal for updating records.
  - **Delete School**: Safety confirmation dialog to prevent accidental deletion.
- **Exports**: One-click download of the complete dataset or filtered view into **Excel (.xlsx)** or **CSV**.

### 2. Page 2: UDISE Lookup API & Integration Sandbox
- **Interactive API Playground**: Test lookups by entering any 11-digit UDISE code (e.g., `24070101201`, `24070503402`).
- **Bidirectional Syncing**: Test `POST` / `PUT` upsert operations with customized JSON payloads.
- **Copy-Paste Integration Snippets**: Ready-to-use code examples for:
  - Browser JavaScript (`fetch`)
  - cURL CLI
  - Python (`requests`)
- **JSON Inspector**: Formatted, syntax-highlighted response viewer with HTTP status codes and round-trip execution latency.

### 3. Page 3: User Management & RBAC
- **User Directory**: View all registered operators, creation dates, and security tiers (`admin` vs `viewer`).
- **User Provisioning**: Admins can create new user accounts with encrypted passwords (`bcryptjs`).
- **Account Safeguards**:
  - Prevents deletion of the primary system administrator (`admin`).
  - Prevents administrators from accidentally deleting their own active account.

### 4. External Client Simulation Demo
- Accessible at `/public/lookup-sample.html` (or `public/lookup-sample.html` on GitHub Pages).
- Demonstrates how a third-party portal (such as an Education Scholarship Portal or District Office Tool) can integrate the SMDb API:
  - Operator types an 11-digit UDISE code.
  - School name, address, district, taluka, principal contacts, and bank info auto-populate instantly.
  - Operator modifies information and pushes updates back into SMDb with timestamp tracking.

---

## 📡 REST API Reference

All API routes are served under `/api` and support CORS for cross-origin integration.

### Authentication Endpoints

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Authenticate with `{ username, password }` and receive JWT token. |
| `GET` | `/api/auth/me` | Public | Returns current authenticated user and role. |
| `POST` | `/api/auth/logout` | Public | Clears authentication cookie. |

### School Directory Endpoints

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/schools` | Public / Viewer | Progressive paginated list of schools with search, sort, and filters. |
| `GET` | `/api/schools/:id` | Public / Viewer | Retrieve a single school record by ID. |
| `POST` | `/api/schools` | Admin | Create a new school record. |
| `PUT` | `/api/schools/:id` | Admin | Update an existing school record. |
| `DELETE` | `/api/schools/:id` | Admin | Delete a school record. |
| `GET` | `/api/schools/export/all` | Public / Viewer | Returns all school records for export. |
| `GET` | `/api/schools/meta/filters` | Public | Returns available districts, talukas map, and school types. |
| `GET` | `/api/stats` | Public | Returns summary counts and district metrics. |

### Dedicated UDISE Lookup & Sync API

#### 1. Lookup School by UDISE
```http
GET /api/schools/udise/:udise_code
```
- **Response `200 OK`**:
```json
{
  "id": "doc_id_123",
  "Sch_UDISE": "#24070101201",
  "Sch_Name": "Shree Swaminarayan Gurukul High School",
  "Sch_District": "Ahmedabad",
  "Sch_Taluka": "City",
  "Sch_Type": "Grant in Aid",
  "Sch_Principal": "Dr. R. Patel",
  "Sch_Principal_No": "9825000001",
  "Account_No": "#0123456789",
  "Bank": "State Bank of India",
  "IFSC": "SBIN0001234",
  "Timestamp": "2026-09-24T10:30:00.000Z"
}
```

#### 2. Sync / Upsert School by UDISE
```http
POST /api/schools/udise/:udise_code
Content-Type: application/json

{
  "Sch_Name": "Updated School Name",
  "Sch_Principal": "New Principal Name",
  "Sch_Principal_No": "9898989898"
}
```
- **Response `200 OK`**:
```json
{
  "success": true,
  "action": "updated",
  "message": "School record updated successfully.",
  "timestamp": "2026-09-24T11:45:00.000Z",
  "data": { ... }
}
```

---

## 📊 Data Model & Schema

Each school document in Firestore contains the following fields:

| Field Name | Type | Description |
|---|---|---|
| `Sch_UDISE` | String | Official 11-digit Unified District Information System for Education code (e.g. `#24070101201`). |
| `Sch_Name` | String | Full registered name of the educational institution. |
| `Sch_District` | String | Administrative district (e.g., Ahmedabad, Vadodara, Surat, Rajkot). |
| `Sch_Taluka` | String | Administrative sub-district / block. |
| `Sch_Place` | String | City, town, or village name. |
| `Sch_Address` | String | Street address and premises details. |
| `Sch_Pincode` | String | 6-digit postal code. |
| `Sch_Type` / `Type` | String | Classification: `Grant in Aid`, `Government`, or `Private`. |
| `Std_From` | String | Starting academic grade / class (e.g. `1` or `9`). |
| `Std_To` | String | Highest academic grade / class (e.g. `10` or `12`). |
| `Sch_Email` | String | Official school institutional email address. |
| `Sch_Principal` | String | Name of the Principal or Head of School. |
| `Sch_Principal_No` | String | Contact phone/mobile number for the Principal. |
| `Sch_Principal_Email`| String | Direct email address of the Principal. |
| `Sch_EC_Teacher` | String | Name of the Eco-Club / Exam In-Charge Teacher. |
| `Sch_EC_Teacher_No` | String | Contact phone for the In-Charge Teacher. |
| `Bank` | String | Name of the authorized banking institution. |
| `Branch` | String | Bank branch name. |
| `Account_Name` | String | Account holder name. |
| `Account_No` | String | Bank account number (e.g. `#1029384756`). |
| `IFSC` | String | 11-character Indian Financial System Code. |
| `PFMS_Code` | String | Public Financial Management System agency code. |
| `File_ID` / `File_Link` | String | Document identifier or Google Drive link to verification records. |
| `Remarks` | String | Administrative notes or inspection status. |
| `EEP_Reg` / `EEP_ID` | String | Environmental Education Program registration tags. |
| `Timestamp` | String | ISO 8601 string of last synchronization or update. |

---

## 🔑 Default Credentials

| Username | Password | Role | Capabilities |
|---|---|---|---|
| `admin` | `admin123` | **Administrator** | Full read, write, create, edit, delete, user administration, sync API |
| `viewer` | `viewer123` | **Viewer** | Read-only search, inspection, column filtering, Excel export, API sandbox |

> 🔒 **Production Note**: In a production deployment, change default credentials immediately via the **User Management** page or your authentication provider.

---

## 📁 Project Structure

```text
├── index.html                   # Single-Page Application entry point (School Master, API Sandbox, Users)
├── server.ts                    # Full-Stack Express server with API routes, CORS & JWT auth
├── vite.config.ts               # Vite configuration (relative base path './' for GitHub Pages)
├── package.json                 # Project dependencies and lifecycle scripts
├── firestore.rules              # Firebase Security Rules for Firestore collections
├── firebase-applet-config.json  # Firebase project credentials & configuration
├── metadata.json                # Project capabilities and metadata
│
├── public/
│   └── lookup-sample.html       # Standalone external integration simulation page
│
└── src/
    ├── app.js                   # Main SPA controller (Tabulator, routing, UI modals, sync logic)
    ├── client-firebase.js       # Client-side Firebase Firestore SDK connector (for static hosts)
    ├── firebase.ts              # Node/Vite Firebase SDK initialization
    ├── firestore-service.ts     # Backend Firestore database queries and CRUD functions
    ├── index.css                # Application styles (Tailwind CSS, Bootstrap custom theme)
    └── data/
        ├── districts_talukas.json # Gujarat Districts and Talukas dictionary
        └── districts_talukas.js   # Native ES module version for browser compatibility
```

---

## 🚀 Getting Started (Local Development)

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18.0 or higher)
- [npm](https://www.npmjs.com/) or [bun](https://bun.sh/)

### 1. Clone the Repository

```bash
git clone https://github.com/panditalap/SMDb.git
cd SMDb
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Local Development Server

```bash
npm run dev
```

The application will start on `http://localhost:3000`. You can log in using `admin` / `admin123`.

### 4. Build for Production

```bash
npm run build
```

The static distribution files will be compiled into the `dist/` directory.

---

## 🌐 GitHub Pages Deployment Guide

This project is configured to run out-of-the-box on **GitHub Pages** at:
`https://<username>.github.io/<repo-name>/` (e.g., `https://panditalap.github.io/SMDb/`).

### How It Works on GitHub Pages
1. `vite.config.ts` specifies `base: './'`, ensuring all assets resolve relatively regardless of subfolder hosting.
2. `index.html` references `./src/index.css` and `./src/app.js`.
3. `src/app.js` detects when running on `github.io` and queries Firebase Firestore directly via `src/client-firebase.js`.

### Deployment Steps

1. In your GitHub repository, go to **Settings** ➔ **Pages**.
2. Under **Build and deployment**:
   - **Source**: Select `Deploy from a branch`.
   - **Branch**: Select `main` (or your publishing branch) and folder `/ (root)`.
3. Click **Save**.
4. Push your commits to GitHub:
   ```bash
   git add .
   git commit -m "Deploy SMDb to GitHub Pages"
   git push origin main
   ```
5. GitHub Pages will build and publish your site at `https://<username>.github.io/SMDb/`.

---

## 🔐 Environment Variables

When running the Express full-stack server, create a `.env` file in the root directory (optional, sensible defaults provided):

```env
PORT=3000
NODE_ENV=development
JWT_SECRET=your-custom-jwt-secret-key
```

Firebase credentials are automatically read from `firebase-applet-config.json`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
