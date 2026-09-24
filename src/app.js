/**
 * SMDb - School Master Database
 * Architecture: Multipage SPA with Tabulator Data Management & Firebase Cloud Sync
 * Supports both Node.js Express backend and static hosts like GitHub Pages
 */

import districtsTalukas from './data/districts_talukas.js';
import * as ClientDb from './client-firebase.js';

// Environment detector: True when hosted on GitHub Pages or standalone static host
const isStaticHost = window.location.hostname.includes('github.io') || 
                     window.location.protocol === 'file:' ||
                     (!window.location.port && window.location.hostname !== 'localhost');

// ══════════════════════════════════════════════════════════════════
// 🔐 Auth & Session Manager
// ══════════════════════════════════════════════════════════════════
const AppAuth = (function () {
  let currentUser = null;
  let currentRole = 'guest';
  let token = localStorage.getItem('smdb_token') || '';

  return {
    async init() {
      try {
        if (!isStaticHost) {
          const res = await fetch('/api/auth/me', {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
          });
          if (res.ok) {
            const data = await res.json();
            if (data.user) {
              currentUser = data.user;
              currentRole = data.user.role;
              this.renderUserBadge();
              return currentRole;
            }
          }
        }
        
        // Fallback or static storage check
        const savedUser = localStorage.getItem('smdb_user');
        if (savedUser) {
          currentUser = JSON.parse(savedUser);
          currentRole = currentUser.role || 'guest';
        } else {
          currentUser = null;
          currentRole = 'guest';
          token = '';
          localStorage.removeItem('smdb_token');
        }
      } catch (e) {
        currentUser = null;
        currentRole = 'guest';
      }
      this.renderUserBadge();
      return currentRole;
    },

    getUser() { return currentUser; },
    getRole() { return currentRole; },
    getToken() { return token; },
    isAdmin() { return currentRole === 'admin'; },

    async login(username, password) {
      let user = null;
      let sessionToken = '';

      if (!isStaticHost) {
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });
          if (res.ok) {
            const data = await res.json();
            sessionToken = data.token;
            user = data.user;
          }
        } catch (e) {
          console.warn('API login request failed, falling back to direct Firebase:', e);
        }
      }

      // If backend was not reached or returned failure on static host, authenticate via Firebase Firestore
      if (!user) {
        const fsUser = await ClientDb.authenticateInFirestore(username, password);
        sessionToken = fsUser.token;
        user = { id: fsUser.id, username: fsUser.username, role: fsUser.role };
      }

      token = sessionToken;
      currentUser = user;
      currentRole = user.role;
      localStorage.setItem('smdb_token', token);
      localStorage.setItem('smdb_user', JSON.stringify(user));

      this.renderUserBadge();
      SchoolsDataMaster.refreshTable();
      UsersPage.loadUsers();
      return user;
    },

    async logout() {
      if (!isStaticHost) {
        try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
      }
      token = '';
      currentUser = null;
      currentRole = 'guest';
      localStorage.removeItem('smdb_token');
      localStorage.removeItem('smdb_user');

      this.renderUserBadge();
      SchoolsDataMaster.refreshTable();
      UsersPage.loadUsers();
      showToast('Logged out successfully.', 'info');
    },

    renderUserBadge() {
      const userLabel = document.getElementById('UserLabel');
      const logoutBtn = document.getElementById('btn-logout-main');
      const addBtn = document.getElementById('schools-btn-add');

      if (currentUser) {
        const admin = currentRole === 'admin';
        userLabel.innerHTML = `
          <i class="bi ${admin ? 'bi-shield-fill-check text-warning' : 'bi-person-check'}"></i>
          <span>${currentUser.username}</span>
          <span class="pill ${admin ? 'pill-green' : 'pill-blue'} ms-1" style="font-size: 0.65rem; padding: 1px 7px;">
            ${admin ? 'Admin' : 'Viewer'}
          </span>
        `;
        logoutBtn.innerHTML = '<i class="bi bi-box-arrow-right"></i> <span class="logout-text">Logout</span>';
        logoutBtn.classList.remove('d-none');
        if (addBtn) addBtn.classList.toggle('d-none', !admin);
      } else {
        userLabel.innerHTML = `
          <i class="bi bi-person"></i>
          <span>Guest</span>
          <span class="pill pill-grey ms-1" style="font-size: 0.65rem; padding: 1px 7px;">Read Only</span>
        `;
        logoutBtn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> <span class="logout-text">Login</span>';
        logoutBtn.classList.remove('d-none');
        if (addBtn) addBtn.classList.add('d-none');
      }
    }
  };
})();

// ══════════════════════════════════════════════════════════════════
// 📊 Page 1: Schools Master Data Tabulator Module
// ══════════════════════════════════════════════════════════════════
const SchoolsDataMaster = (function () {
  let table = null;
  let rawData = [];
  let showingSelected = false;
  let headerCheckbox = null;
  let showSelFilterFn = null;

  const $ = id => document.getElementById(id);

  // ════════════════════════════════════════
  // 🎨 Formatters
  // ════════════════════════════════════════
  function fmtText(cell) {
    const v = cell.getValue();
    if (v === null || v === undefined || v === '') return '<span class="text-muted">—</span>';
    return String(v);
  }

  function fmtEdit(cell) {
    const row = cell.getRow().getData();
    const isAdmin = AppAuth.isAdmin();
    const safeId = String(row.id || '').replace(/'/g, "\\'");
    return `
      <div class="d-flex align-items-center justify-content-center gap-1" onclick="event.stopPropagation()">
        <button type="button" class="btn-view-row" title="View Details" onclick="event.stopPropagation(); SchoolsDataMaster.viewRow('${safeId}')">👁️</button>
        ${isAdmin ? `<button type="button" class="btn-edit-row" title="Edit School" onclick="event.stopPropagation(); SchoolsDataMaster.editRow('${safeId}')">✏️</button>` : ''}
        ${isAdmin ? `<button type="button" class="btn-delete-row" title="Delete School" onclick="event.stopPropagation(); SchoolsDataMaster.deleteRowPrompt('${safeId}')">🗑️</button>` : ''}
      </div>
    `;
  }

  function fmtUDISE(cell) {
    const v = (cell.getValue() || '').toString();
    const clean = v.replace(/#/g, '');
    return `<span class="pill pill-dark font-monospace"><i class="bi bi-hash"></i>${clean}</span>`;
  }

  function fmtSchoolName(cell) {
    const row = cell.getRow().getData();
    const name = row.Sch_Name || 'Untitled School';
    const cleanUdise = (row.Sch_UDISE || '').toString().replace(/#/g, '');
    const district = row.Sch_District || '';
    const safeId = String(row.id || '').replace(/'/g, "\\'");

    return `
      <div class="d-flex flex-column py-1" style="cursor: pointer;" onclick="SchoolsDataMaster.viewRow('${safeId}')">
        <span class="fw-bold text-primary text-truncate text-decoration-underline" style="max-width: 320px;" title="${name}">
          ${name}
        </span>
        <span class="text-muted small" style="font-size: 0.72rem;">
          <i class="bi bi-geo-alt me-1"></i>${district || 'Gujarat'} &bull; UDISE: ${cleanUdise}
        </span>
      </div>
    `;
  }

  function fmtType(cell) {
    const v = cell.getValue() || 'Grant in Aid';
    const pillClass = v === 'Grant in Aid' ? 'pill-blue' :
                      v === 'Government' ? 'pill-green' :
                      v === 'Private' ? 'pill-amber' : 'pill-grey';
    return `<span class="pill ${pillClass}">${v}</span>`;
  }

  // ════════════════════════════════════════
  // ⊞ Column Selector Modal
  // ════════════════════════════════════════
  function buildColumnCheckboxes() {
    if (!table) return '';
    const cols = table.getColumns();
    const skipFields = ['_rowNum', 'ACTIONS', 'SELECT_ROW'];

    return cols
      .filter(c => !skipFields.includes(c.getField()))
      .map(c => {
        const field = c.getField();
        const title = c.getDefinition().title || field;
        const checked = c.isVisible() ? 'checked' : '';
        return `
          <div class="col-sm-6 col-md-4 mb-2">
            <div class="form-check">
              <input class="form-check-input col-vis-chk" type="checkbox" id="chk-col-${field}" data-field="${field}" ${checked}>
              <label class="form-check-label small" for="chk-col-${field}">${title}</label>
            </div>
          </div>
        `;
      }).join('');
  }

  function showColumns() {
    if (!table) return;
    const body = $('col-modal-body');
    if (!body) return;

    body.innerHTML = buildColumnCheckboxes();
    body.querySelectorAll('.col-vis-chk').forEach(cb => {
      cb.addEventListener('change', toggleColumn);
    });

    const modal = new bootstrap.Modal($('modal-column-selector'));
    modal.show();
  }

  function toggleColumn(e) {
    const cb = e.target;
    cb.checked
      ? table.showColumn(cb.dataset.field)
      : table.hideColumn(cb.dataset.field);
  }

  // ════════════════════════════════════════
  // 📊 Columns Definition
  // ════════════════════════════════════════
  let exportSerialCounter = 0;

  function buildColumns() {
    return [
      { 
        title: '#', 
        field: '_rowNum', 
        formatter: 'rownum', 
        hozAlign: 'center', 
        headerHozAlign: 'center', 
        headerSort: false, 
        resizable: false, 
        width: 45,
        download: true,
        downloadTitle: '#',
        accessorDownload: (value, data, type, params, column, row) => {
          if (row && typeof row.getPosition === 'function') {
            const pos = row.getPosition(true);
            if (pos) return pos;
          }
          exportSerialCounter++;
          return exportSerialCounter;
        }
      },
      { 
        title: 'Actions', 
        field: 'ACTIONS', 
        formatter: fmtEdit, 
        width: 110, 
        hozAlign: 'center', 
        headerHozAlign: 'center', 
        headerSort: false, 
        resizable: false,
        download: false,
        cellClick: (e, cell) => { e.stopPropagation(); }
      },
      { title: 'UDISE Code', field: 'Sch_UDISE', width: 140, formatter: fmtUDISE, headerFilter: 'input' },
      { title: 'School Name', field: 'Sch_Name', minWidth: 260, formatter: fmtSchoolName, headerFilter: 'input' },
      { title: 'Address', field: 'Sch_Address', minWidth: 260, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'District', field: 'Sch_District', width: 140, formatter: fmtText, headerFilter: 'input' },
      { title: 'Taluka', field: 'Sch_Taluka', width: 130, formatter: fmtText, headerFilter: 'input' },
      { title: 'Place', field: 'Sch_Place', width: 130, formatter: fmtText, headerFilter: 'input' },
      { title: 'Pincode', field: 'Sch_Pincode', width: 100, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'Sch Email', field: 'Sch_Email', width: 180, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'Principal', field: 'Sch_Principal', width: 180, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'Pri Phone', field: 'Sch_Principal_No', width: 140, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'Pri Email', field: 'Sch_Principal_Email', width: 180, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'EC Teacher', field: 'Sch_EC_Teacher', width: 160, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'EC Phone', field: 'Sch_EC_Teacher_No', width: 140, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'EC Email', field: 'Sch_EC_Teacher_Em', width: 160, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'School Type', field: 'Sch_Type', width: 140, formatter: fmtType, headerFilter: 'input', visible: false },
      { title: 'Std From', field: 'Std_From', width: 100, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'Std To', field: 'Std_To', width: 100, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'Account No', field: 'Account_No', width: 140, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'IFSC Code', field: 'IFSC', width: 130, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'Bank Name', field: 'Bank', width: 160, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'Bank Branch', field: 'Branch', width: 140, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'PFMS Code', field: 'PFMS_Code', width: 130, formatter: fmtText, headerFilter: 'input', visible: false },
      { title: 'EEP Reg', field: 'EEP_Reg', width: 140, formatter: fmtText, headerFilter: 'input', visible: false }
    ];
  }

  // ════════════════════════════════════════
  // ⚙️ Core Build (Progressive AJAX Table)
  // ════════════════════════════════════════
  function build() {
    table = new Tabulator('#schools-tabulator-table', {
      ajaxURL: '/api/schools',
      ajaxConfig: 'GET',
      ajaxContentType: 'json',
      layout: 'fitDataFill',
      height: '520px',
      selectable: true,
      pagination: true,
      paginationMode: 'remote',
      filterMode: 'remote',
      sortMode: 'remote',
      paginationSize: 10,
      paginationSizeSelector: [10, 25, 50, 100, true],
      placeholder: '<div class="p-4 text-center text-muted"><i class="bi bi-inbox fs-2 d-block mb-1"></i>No matching school records found.</div>',

      ajaxRequestFunc: async function (url, config, params) {
        if (!isStaticHost) {
          try {
            const queryParams = new URLSearchParams(params).toString();
            const res = await fetch(`${url}?${queryParams}`, config);
            if (res.ok) {
              const data = await res.json();
              rawData = data.data || [];
              return data;
            }
          } catch (e) {
            console.warn('[SMDb] Backend API unreachable, loading directly from Firebase Firestore...');
          }
        }
        // Direct Firebase Firestore query
        const data = await ClientDb.querySchoolsForTabulator(params);
        rawData = data.data || [];
        return data;
      },

      ajaxParams: function () {
        return {
          search: ($('schools-search')?.value || '').trim(),
          district: $('filter-district-select')?.value || '',
          sch_type: $('filter-type-select')?.value || '',
          type: $('filter-type-select')?.value || ''
        };
      },

      ajaxResponse: function (url, params, response) {
        rawData = response.data || [];
        return response;
      },

      rowHeader: {
        resizable: false,
        headerHozAlign: 'center',
        hozAlign: 'center',
        width: 40,
        titleFormatter: function () {
          headerCheckbox = document.createElement('input');
          headerCheckbox.type = 'checkbox';
          headerCheckbox.className = 'form-check-input m-0';
          headerCheckbox.addEventListener('change', function () {
            const rows = table.getRows('active');
            rows.forEach(r => {
              if (typeof r.select === 'function') {
                headerCheckbox.checked ? r.select() : r.deselect();
              }
            });
            refreshCounts();
          });
          return headerCheckbox;
        },
        formatter: 'rowSelection',
        headerSort: false,
        cellClick: function (e, cell) {
          cell.getRow().toggleSelect();
          refreshCounts();
        }
      },

      columns: buildColumns()
    });

    table.on('rowSelectionChanged', function () {
      refreshCounts();
    });

    table.on('dataLoaded', function () {
      refreshCounts();
    });
  }

  function destroy() {
    if (table) {
      table.destroy();
      table = null;
    }
  }

  function refreshCounts() {
    if (!table) return;
    setTimeout(() => {
      const selected = table.getSelectedRows().length;

      const selBadge = $('schools-sel-badge');
      if (selBadge) {
        selBadge.textContent = selected;
      }

      const btn = $('schools-btn-show-sel');
      if (btn) {
        btn.classList.toggle('d-none', selected === 0 && !showingSelected);
      }

      if (headerCheckbox) {
        const visible = table.getRows('active').length;
        headerCheckbox.indeterminate = selected > 0 && selected < visible;
        headerCheckbox.checked = visible > 0 && selected >= visible;
      }

      if (showingSelected && selected === 0) {
        showingSelected = false;
        if (showSelFilterFn) {
          table.removeFilter(showSelFilterFn);
          showSelFilterFn = null;
        }
      }
    }, 0);
  }

  // ════════════════════════════════════════
  // 🔍 Public Actions
  // ════════════════════════════════════════
  let searchDebounceTimer = null;
  function search(val) {
    if (!table) return;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      table.setData();
      refreshCounts();
    }, 250);
  }

  function toggleSelected() {
    const selectedRows = table.getSelectedRows();

    if (!showingSelected && selectedRows.length === 0) {
      showToast('⚠️ Select rows first', 'warning');
      return;
    }

    const btn = $('schools-btn-show-sel');

    if (showingSelected) {
      if (showSelFilterFn) {
        table.removeFilter(showSelFilterFn);
        showSelFilterFn = null;
      }
      showingSelected = false;
      if (btn) {
        btn.classList.remove('primary');
        btn.classList.add('ghost');
        btn.innerHTML = '☑ <span>Selected</span> <span class="sel-badge" id="schools-sel-badge">0</span>';
      }
    } else {
      const ids = new Set(selectedRows.map(r => r.getData().id));
      showSelFilterFn = d => ids.has(d.id);
      table.addFilter(showSelFilterFn);
      showingSelected = true;
      if (btn) {
        btn.classList.add('primary');
        btn.classList.remove('ghost');
        btn.innerHTML = '📋 <span>Show All</span>';
      }
    }
    refreshCounts();
  }

  function clear() {
    const searchInput = $('schools-search');
    if (searchInput) searchInput.value = '';
    const distSelect = $('filter-district-select');
    if (distSelect) distSelect.value = '';
    const typeSelect = $('filter-type-select');
    if (typeSelect) typeSelect.value = '';

    if (table) {
      table.clearFilter();
      table.clearHeaderFilter();
      table.setData();
    }
    showingSelected = false;
    showSelFilterFn = null;
    refreshCounts();
  }

  function refreshTable() {
    if (table) {
      table.setData();
      refreshCounts();
    }
  }

  function exportToExcel(fileName = "SMDb_Schools_Master.xlsx") {
    if (!table) {
      showToast('No table instance found to export.', 'warning');
      return;
    }
    exportSerialCounter = 0;
    table.download("xlsx", fileName, {
      sheetName: "Schools Master",
      downloadData: "active",
    });
    showToast('Exporting active table view to Excel...', 'info');
  }

  // Row inspection & actions
  async function viewRow(id) {
    try {
      let school = null;
      if (!isStaticHost) {
        try {
          const res = await fetch(`/api/schools/${id}`);
          if (res.ok) school = await res.json();
        } catch (e) {}
      }
      if (!school) {
        school = await ClientDb.getSchoolByIdFromFirestore(String(id));
      }
      if (!school) throw new Error('Failed to fetch school details.');
      SchoolFormAndDetailModal.showDetail(school);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  async function editRow(id) {
    if (!AppAuth.isAdmin()) {
      showToast('Administrator privileges required.', 'warning');
      return;
    }
    try {
      let school = null;
      if (!isStaticHost) {
        try {
          const res = await fetch(`/api/schools/${id}`);
          if (res.ok) school = await res.json();
        } catch (e) {}
      }
      if (!school) {
        school = await ClientDb.getSchoolByIdFromFirestore(String(id));
      }
      if (!school) throw new Error('Failed to fetch school.');
      SchoolFormAndDetailModal.showEdit(school);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }

  function deleteRowPrompt(id) {
    if (!AppAuth.isAdmin()) {
      showToast('Administrator privileges required.', 'warning');
      return;
    }
    SchoolFormAndDetailModal.showDeletePrompt(id);
  }

  // ════════════════════════════════════════
  // 🚀 Public API
  // ════════════════════════════════════════
  return {
    init() {
      build();
    },
    destroy,
    search,
    toggleSelected,
    clear,
    showColumns,
    refreshTable,
    redraw() { if (table) table.redraw(true); },
    exportToExcel,
    viewRow,
    editRow,
    deleteRowPrompt
  };
})();

// ══════════════════════════════════════════════════════════════════
// 📝 School Multi-Section Form & Detail Modal Manager
// ══════════════════════════════════════════════════════════════════
function populateTalukasForDistrict(districtName, selectedTaluka = '') {
  const talukaSelect = document.getElementById('field-Sch_Taluka');
  if (!talukaSelect) return;
  talukaSelect.innerHTML = '<option value="">-- Select Taluka --</option>';

  const talukas = (districtsTalukas && districtsTalukas[districtName]) ? districtsTalukas[districtName] : [];
  talukas.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (selectedTaluka && selectedTaluka.trim().toLowerCase() === t.trim().toLowerCase()) {
      opt.selected = true;
    }
    talukaSelect.appendChild(opt);
  });

  if (selectedTaluka && !talukas.some(t => t.trim().toLowerCase() === selectedTaluka.trim().toLowerCase())) {
    const customOpt = document.createElement('option');
    customOpt.value = selectedTaluka;
    customOpt.textContent = selectedTaluka;
    customOpt.selected = true;
    talukaSelect.appendChild(customOpt);
  }
}

const SchoolFormAndDetailModal = (function () {
  let formModal = null;
  let detailModal = null;
  let deleteModal = null;
  let editingId = null;
  let pendingDeleteId = null;

  const ALL_FIELDS = [
    'Sch_UDISE', 'Sch_Name', 'Sch_Address', 'Sch_District', 'Sch_Taluka',
    'Sch_Place', 'Sch_Pincode', 'Sch_Email', 'Sch_Principal', 'Sch_Principal_No',
    'Sch_Principal_Email', 'Sch_EC_Teacher', 'Sch_EC_Teacher_No', 'Sch_EC_Teacher_Em',
    'Sch_Type', 'Type', 'Std_From', 'Std_To', 'Account_Name', 'Account_No', 'Bank', 'Branch',
    'IFSC', 'PFMS_Code', 'File_ID', 'File_Link', 'Remarks', 'EEP_Reg', 'EEP_ID'
  ];

  return {
    init() {
      formModal = new bootstrap.Modal(document.getElementById('modal-school'));
      detailModal = new bootstrap.Modal(document.getElementById('modal-detail'));
      deleteModal = new bootstrap.Modal(document.getElementById('modal-delete'));

      document.getElementById('form-school').addEventListener('submit', this.handleFormSubmit.bind(this));
      document.getElementById('btn-confirm-delete').addEventListener('click', this.handleDeleteConfirm.bind(this));
    },

    showAdd() {
      if (!AppAuth.isAdmin()) {
        showToast('Administrator role required to register schools.', 'warning');
        return;
      }
      editingId = null;
      const form = document.getElementById('form-school');
      form.reset();
      document.getElementById('school-form-alert').classList.add('d-none');
      document.getElementById('modal-school-title').innerHTML = '<i class="bi bi-building-add me-2 text-primary"></i>Register New School';

      const distSelect = document.getElementById('field-Sch_District');
      if (distSelect && distSelect.options.length > 1) {
        distSelect.selectedIndex = 1;
        populateTalukasForDistrict(distSelect.value);
      } else {
        populateTalukasForDistrict('');
      }

      const typeSelect = document.getElementById('field-Sch_Type');
      if (typeSelect) typeSelect.value = 'Grant in Aid';

      const modalBody = document.querySelector('#modal-school .modal-body');
      if (modalBody) modalBody.scrollTop = 0;

      formModal.show();
    },

    showEdit(school) {
      if (!AppAuth.isAdmin()) {
        showToast('Administrator role required to edit schools.', 'warning');
        return;
      }
      editingId = school.id;
      document.getElementById('school-form-alert').classList.add('d-none');
      document.getElementById('modal-school-title').innerHTML = `<i class="bi bi-pencil-square me-2 text-primary"></i>Edit School: ${school.Sch_Name}`;

      const distSelect = document.getElementById('field-Sch_District');
      if (distSelect) {
        distSelect.value = school.Sch_District || '';
        populateTalukasForDistrict(school.Sch_District || '', school.Sch_Taluka || '');
      }

      ALL_FIELDS.forEach(f => {
        const el = document.getElementById(`field-${f}`);
        if (el) {
          let val = school[f] !== null && school[f] !== undefined ? school[f] : '';
          if (f === 'Sch_UDISE' || f === 'Account_No') {
            val = String(val).replace(/#/g, '');
          } else if (f === 'Std_From' || f === 'Std_To') {
            val = String(val).replace(/^Class\s*/i, '').trim();
          }
          el.value = val;
        }
      });

      const typeSelect = document.getElementById('field-Sch_Type');
      if (typeSelect) {
        typeSelect.value = school.Sch_Type || school.Type || 'Grant in Aid';
      }

      const modalBody = document.querySelector('#modal-school .modal-body');
      if (modalBody) modalBody.scrollTop = 0;

      formModal.show();
    },

    showDetail(school) {
      const cleanUdise = (school.Sch_UDISE || '').replace(/#/g, '');
      const cleanAccount = school.Account_No ? school.Account_No.replace(/#/g, '') : 'N/A';
      const cleanStdFrom = (school.Std_From || '').replace(/^Class\s*/i, '') || 'N/A';
      const cleanStdTo = (school.Std_To || '').replace(/^Class\s*/i, '') || 'N/A';

      document.getElementById('detail-school-name').textContent = school.Sch_Name || 'Untitled School';
      document.getElementById('detail-udise-badge').textContent = cleanUdise || '-';
      const uidBadge = document.getElementById('detail-uid-badge');
      if (uidBadge) uidBadge.style.display = 'none';

      const schType = school.Sch_Type || school.Type || 'Grant in Aid';
      const typeBadge = document.getElementById('detail-type-badge');
      if (typeBadge) {
        typeBadge.textContent = schType;
        typeBadge.className = schType === 'Grant in Aid' ? 'pill pill-blue' :
                              schType === 'Government' ? 'pill pill-green' :
                              schType === 'Private' ? 'pill pill-amber' : 'pill pill-grey';
      }

      document.getElementById('detail-timestamp').textContent = school.Timestamp ? new Date(school.Timestamp).toLocaleString() : 'N/A';

      document.getElementById('detail-address').textContent = school.Sch_Address || 'N/A';
      document.getElementById('detail-place').textContent = school.Sch_Place || 'N/A';
      document.getElementById('detail-district').textContent = school.Sch_District || 'N/A';
      document.getElementById('detail-taluka').textContent = school.Sch_Taluka || 'N/A';
      document.getElementById('detail-pincode').textContent = school.Sch_Pincode || 'N/A';
      document.getElementById('detail-remarks').textContent = school.Remarks || 'None';

      document.getElementById('detail-email').innerHTML = school.Sch_Email ? `<a href="mailto:${school.Sch_Email}">${school.Sch_Email}</a>` : 'N/A';
      document.getElementById('detail-principal').textContent = school.Sch_Principal || 'N/A';
      document.getElementById('detail-principal-no').innerHTML = school.Sch_Principal_No ? `<a href="tel:${school.Sch_Principal_No}">${school.Sch_Principal_No}</a>` : 'N/A';
      document.getElementById('detail-principal-em').innerHTML = school.Sch_Principal_Email ? `<a href="mailto:${school.Sch_Principal_Email}">${school.Sch_Principal_Email}</a>` : 'N/A';
      document.getElementById('detail-teacher').textContent = school.Sch_EC_Teacher || 'N/A';
      document.getElementById('detail-teacher-no').innerHTML = school.Sch_EC_Teacher_No ? `<a href="tel:${school.Sch_EC_Teacher_No}">${school.Sch_EC_Teacher_No}</a>` : 'N/A';

      document.getElementById('detail-std-from').textContent = cleanStdFrom;
      document.getElementById('detail-std-to').textContent = cleanStdTo;

      document.getElementById('detail-bank').textContent = school.Bank || 'N/A';
      document.getElementById('detail-branch').textContent = school.Branch || 'N/A';
      document.getElementById('detail-ifsc').textContent = school.IFSC || 'N/A';
      document.getElementById('detail-pfms').textContent = school.PFMS_Code || 'N/A';
      document.getElementById('detail-account-no').textContent = cleanAccount;

      document.getElementById('detail-file-id').textContent = school.File_ID || 'N/A';
      const fileLinkEl = document.getElementById('detail-file-link');
      if (school.File_Link) {
        fileLinkEl.innerHTML = `<a href="${school.File_Link}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary py-0"><i class="bi bi-box-arrow-up-right me-1"></i>Open File</a>`;
      } else {
        fileLinkEl.textContent = 'None';
      }
      document.getElementById('detail-eep-reg').textContent = school.EEP_Reg || 'N/A';
      document.getElementById('detail-eep-id').textContent = school.EEP_ID || 'N/A';

      const editBtn = document.getElementById('detail-btn-edit');
      if (AppAuth.isAdmin()) {
        editBtn.classList.remove('d-none');
        editBtn.onclick = () => {
          detailModal.hide();
          this.showEdit(school);
        };
      } else {
        editBtn.classList.add('d-none');
      }

      document.getElementById('detail-btn-test-api').onclick = () => {
        detailModal.hide();
        AppRouter.navigate('udise-api');
        UDISEApiPage.testUDISE(cleanUdise);
      };

      detailModal.show();
    },

    showDeletePrompt(id) {
      pendingDeleteId = id;
      let school = rawData.find(s => String(s.id) === String(id));
      document.getElementById('delete-school-name').textContent = school?.Sch_Name || `School ID: ${id}`;
      document.getElementById('delete-school-udise').textContent = school?.Sch_UDISE ? school.Sch_UDISE.replace(/#/g, '') : '-';
      deleteModal.show();
    },

    async handleFormSubmit(e) {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-save-school');
      const alertEl = document.getElementById('school-form-alert');
      alertEl.classList.add('d-none');

      const payload = {};
      ALL_FIELDS.forEach(f => {
        const el = document.getElementById(`field-${f}`);
        if (el) payload[f] = el.value.trim();
      });

      if (!payload.Sch_UDISE) {
        alertEl.textContent = 'School UDISE Code is required.';
        alertEl.classList.remove('d-none');
        return;
      }

      const cleanUdise = payload.Sch_UDISE.replace(/#/g, '').trim();
      payload.Sch_UDISE = '#' + cleanUdise;

      if (payload.Account_No) {
        const cleanAcc = payload.Account_No.replace(/#/g, '').trim();
        payload.Account_No = cleanAcc ? '#' + cleanAcc : '';
      }

      if (payload.Std_From) {
        payload.Std_From = payload.Std_From.replace(/^Class\s*/i, '').trim();
      }
      if (payload.Std_To) {
        payload.Std_To = payload.Std_To.replace(/^Class\s*/i, '').trim();
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

      try {
        let saved = false;
        if (!isStaticHost) {
          try {
            const isEdit = editingId !== null;
            const url = isEdit ? `/api/schools/${editingId}` : '/api/schools';
            const method = isEdit ? 'PUT' : 'POST';

            const res = await fetch(url, {
              method,
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppAuth.getToken()}`
              },
              body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (res.ok) {
              saved = true;
            } else {
              throw new Error(data.error || 'Failed to save');
            }
          } catch (e) {
            console.warn('Backend API save failed, attempting Firestore direct sync:', e);
          }
        }

        if (!saved) {
          // Direct Firebase Firestore sync
          await ClientDb.upsertSchoolInFirestore(cleanUdise, payload);
        }

        formModal.hide();
        SchoolsDataMaster.refreshTable();
        loadDashboardStats();
        showToast('School record saved successfully to Firestore!', 'success');
      } catch (err) {
        alertEl.textContent = err.message;
        alertEl.classList.remove('d-none');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Save Record';
      }
    },

    async handleDeleteConfirm() {
      if (!pendingDeleteId) return;
      const btn = document.getElementById('btn-confirm-delete');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Deleting...';

      try {
        let deleted = false;
        if (!isStaticHost) {
          try {
            const res = await fetch(`/api/schools/${pendingDeleteId}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${AppAuth.getToken()}` }
            });
            if (res.ok) deleted = true;
          } catch (e) {}
        }

        if (!deleted) {
          await ClientDb.deleteSchoolFromFirestore(String(pendingDeleteId));
        }

        deleteModal.hide();
        SchoolsDataMaster.refreshTable();
        loadDashboardStats();
        showToast('School permanently deleted from Firestore.', 'success');
      } catch (err) {
        showToast(err.message, 'danger');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-trash me-1"></i>Yes, Delete';
        pendingDeleteId = null;
      }
    }
  };
})();

// ══════════════════════════════════════════════════════════════════
// ⚡ Page 2: UDISE Lookup API and Integration Module
// ══════════════════════════════════════════════════════════════════
const UDISEApiPage = (function () {
  let currentMode = 'GET';

  return {
    init() {
      const testBtn = document.getElementById('btn-sandbox-fetch');
      if (testBtn) {
        testBtn.addEventListener('click', () => this.testUDISE());
      }
      const input = document.getElementById('sandbox-udise-input');
      if (input) {
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') this.testUDISE();
        });
      }

      document.querySelectorAll('.btn-test-udise').forEach(chip => {
        chip.addEventListener('click', (e) => {
          const code = e.currentTarget.getAttribute('data-code');
          this.testUDISE(code);
        });
      });

      document.getElementById('btn-copy-fetch-code')?.addEventListener('click', () => {
        const code = document.getElementById('code-snippet-fetch').innerText;
        navigator.clipboard.writeText(code).then(() => showToast('JavaScript code copied!', 'success'));
      });
      document.getElementById('btn-copy-curl-code')?.addEventListener('click', () => {
        const code = document.getElementById('code-snippet-curl').innerText;
        navigator.clipboard.writeText(code).then(() => showToast('cURL command copied!', 'success'));
      });
    },

    setMode(mode) {
      currentMode = mode;
      const getBtn = document.getElementById('btn-tab-mode-get');
      const postBtn = document.getElementById('btn-tab-mode-post');
      const postContainer = document.getElementById('sandbox-post-container');
      const actionBtnText = document.getElementById('sandbox-action-btn-text');
      const curlSnippet = document.getElementById('code-snippet-curl');
      const methodLabel = document.getElementById('sandbox-method-label');

      if (mode === 'GET') {
        getBtn?.classList.add('active');
        postBtn?.classList.remove('active');
        postContainer?.classList.add('d-none');
        if (actionBtnText) actionBtnText.textContent = 'Query API';
        if (methodLabel) methodLabel.innerHTML = '<i class="bi bi-search text-primary"></i>';
        if (curlSnippet) curlSnippet.textContent = 'curl -X GET "https://panditalap.github.io/SMDb/api/schools/udise/24070101201"';
      } else {
        postBtn?.classList.add('active');
        getBtn?.classList.remove('active');
        postContainer?.classList.remove('d-none');
        if (actionBtnText) actionBtnText.textContent = 'Sync / Upsert Record';
        if (methodLabel) methodLabel.innerHTML = '<i class="bi bi-cloud-arrow-up-fill text-success"></i>';
        if (curlSnippet) curlSnippet.textContent = `curl -X POST "https://panditalap.github.io/SMDb/api/schools/udise/24070101201" -H "Content-Type: application/json" -d '{"Sch_Principal":"New Principal Name"}'`;
      }
    },

    async testUDISE(code) {
      const rawUdise = code || document.getElementById('sandbox-udise-input').value;
      const spinner = document.getElementById('sandbox-spinner');
      const statusBadge = document.getElementById('sandbox-status-badge');
      const previewCard = document.getElementById('sandbox-school-preview');
      const jsonOutput = document.getElementById('sandbox-json-output');

      const udise = (rawUdise || '').replace(/#/g, '').trim();

      if (!udise) {
        showToast('Please enter an 11-digit UDISE code.', 'warning');
        return;
      }

      document.getElementById('sandbox-udise-input').value = udise;
      spinner.classList.remove('d-none');

      const start = performance.now();
      try {
        let schoolData = null;
        let actionMessage = '';

        if (currentMode === 'GET') {
          if (!isStaticHost) {
            try {
              const res = await fetch(`/api/schools/udise/${encodeURIComponent(udise)}`);
              if (res.ok) schoolData = await res.json();
            } catch (e) {}
          }
          if (!schoolData) {
            schoolData = await ClientDb.lookupSchoolByUDISEInFirestore(udise);
          }
        } else {
          // POST / PUT mode
          const payloadRaw = document.getElementById('sandbox-post-payload')?.value || '{}';
          let payload;
          try {
            payload = JSON.parse(payloadRaw);
          } catch (err) {
            throw new Error('Invalid JSON format in Sync Payload textarea.');
          }
          payload.Sch_UDISE = udise;

          if (!isStaticHost) {
            try {
              const res = await fetch(`/api/schools/udise/${encodeURIComponent(udise)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(payload)
              });
              if (res.ok) {
                const json = await res.json();
                schoolData = json.data || json;
                actionMessage = json.action ? ` - ${json.action.toUpperCase()}` : '';
              }
            } catch (e) {}
          }

          if (!schoolData) {
            const fsResult = await ClientDb.upsertSchoolInFirestore(udise, payload);
            schoolData = fsResult.school;
            actionMessage = ` - ${fsResult.action.toUpperCase()}`;
          }
        }

        const elapsed = Math.round(performance.now() - start);

        if (schoolData) {
          statusBadge.className = 'pill pill-green';
          statusBadge.innerHTML = `<i class="bi bi-check2-circle me-1"></i>200 OK (${elapsed}ms)${actionMessage}`;

          previewCard.classList.remove('d-none');
          document.getElementById('preview-name').textContent = schoolData.Sch_Name || 'Untitled School';
          document.getElementById('preview-udise').textContent = schoolData.Sch_UDISE;
          document.getElementById('preview-district').textContent = schoolData.Sch_District || '-';
          document.getElementById('preview-taluka').textContent = schoolData.Sch_Taluka || '-';
          document.getElementById('preview-principal').textContent = schoolData.Sch_Principal || '-';
          document.getElementById('preview-phone').textContent = schoolData.Sch_Principal_No || '-';
          document.getElementById('preview-bank').textContent = schoolData.Bank ? `${schoolData.Bank} (${schoolData.Branch || ''})` : '-';
          document.getElementById('preview-ifsc').textContent = schoolData.IFSC || '-';

          if (currentMode === 'POST') {
            showToast('School synced to Firestore SMDb successfully!', 'success');
            SchoolsDataMaster.refreshTable();
            loadDashboardStats();
          }

          jsonOutput.textContent = JSON.stringify(schoolData, null, 2);
        } else {
          statusBadge.className = 'pill pill-red';
          statusBadge.innerHTML = `<i class="bi bi-x-circle me-1"></i>404 Not Found (${elapsed}ms)`;
          previewCard.classList.add('d-none');
          jsonOutput.textContent = JSON.stringify({ error: `School not found for UDISE: ${udise}` }, null, 2);
        }
      } catch (err) {
        statusBadge.className = 'pill pill-red';
        statusBadge.innerHTML = 'Error';
        jsonOutput.textContent = JSON.stringify({ error: err.message }, null, 2);
        previewCard.classList.add('d-none');
        showToast(err.message, 'danger');
      } finally {
        spinner.classList.add('d-none');
      }
    }
  };
})();

// ══════════════════════════════════════════════════════════════════
// 👥 Page 3: User Management Module
// ══════════════════════════════════════════════════════════════════
const UsersPage = (function () {
  return {
    init() {
      document.getElementById('form-create-user-page')?.addEventListener('submit', this.handleCreateUser.bind(this));
    },

    async loadUsers() {
      const tbody = document.getElementById('users-page-table-body');
      const container = document.getElementById('users-page-content');
      const nonAdminNotice = document.getElementById('users-nonadmin-notice');

      if (!AppAuth.isAdmin()) {
        if (container) container.classList.add('d-none');
        if (nonAdminNotice) nonAdminNotice.classList.remove('d-none');
        return;
      }

      if (container) container.classList.remove('d-none');
      if (nonAdminNotice) nonAdminNotice.classList.add('d-none');

      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading users...</td></tr>';

      try {
        let userList = null;
        if (!isStaticHost) {
          try {
            const res = await fetch('/api/users', {
              headers: { 'Authorization': `Bearer ${AppAuth.getToken()}` }
            });
            if (res.ok) {
              const data = await res.json();
              userList = data.users || [];
            }
          } catch (e) {}
        }

        if (!userList) {
          userList = await ClientDb.getUsersFromFirestore();
        }

        if (!userList || userList.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted">No users found.</td></tr>';
          return;
        }

        tbody.innerHTML = '';
        const current = AppAuth.getUser();
        userList.forEach(u => {
          const isSelf = current && current.id === u.id;
          const isPrimaryAdmin = u.username === 'admin';
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td class="font-monospace">${u.id}</td>
            <td>
              <span class="fw-bold">${u.username}</span>
              ${isSelf ? '<span class="pill pill-grey ms-1" style="font-size: 0.65rem;">You</span>' : ''}
            </td>
            <td>
              <span class="pill ${u.role === 'admin' ? 'pill-green' : 'pill-blue'}">
                ${u.role}
              </span>
            </td>
            <td class="small text-muted">${new Date(u.created_at || Date.now()).toLocaleDateString()}</td>
            <td>
              <button class="btn btn-outline-danger btn-sm py-0 btn-del-usr" data-id="${u.id}" ${isSelf || isPrimaryAdmin ? 'disabled title="Cannot delete primary administrator"' : 'title="Delete user"'}>
                <i class="bi bi-trash"></i>
              </button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-danger">${err.message}</td></tr>`;
      }
    },

    async handleCreateUser(e) {
      e.preventDefault();
      const username = document.getElementById('new-usr-name').value.trim();
      const password = document.getElementById('new-usr-pwd').value;
      const role = document.getElementById('new-usr-role').value;
      const alertEl = document.getElementById('user-page-alert');
      const btn = document.getElementById('btn-create-user-page');

      if (!username || !password || !role) {
        alertEl.textContent = 'All fields are required.';
        alertEl.classList.remove('d-none');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating...';

      try {
        let created = false;
        if (!isStaticHost) {
          try {
            const res = await fetch('/api/users', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppAuth.getToken()}`
              },
              body: JSON.stringify({ username, password, role })
            });
            if (res.ok) created = true;
          } catch (e) {}
        }

        document.getElementById('form-create-user-page').reset();
        alertEl.classList.add('d-none');
        showToast(`User '${username}' created successfully!`, 'success');
        this.loadUsers();
      } catch (err) {
        alertEl.textContent = err.message;
        alertEl.classList.remove('d-none');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-person-plus me-1"></i>Create Account';
      }
    }
  };
})();

// ══════════════════════════════════════════════════════════════════
// 🧭 Multipage Router
// ══════════════════════════════════════════════════════════════════
const AppRouter = (function () {
  const pages = ['schools', 'udise-api', 'users'];

  function updateView(pageId) {
    const active = pages.includes(pageId) ? pageId : 'schools';

    document.querySelectorAll('.app-page-pane').forEach(pane => {
      pane.classList.add('d-none');
    });
    const targetPane = document.getElementById(`page-${active}`);
    if (targetPane) targetPane.classList.remove('d-none');

    document.querySelectorAll('.page-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-page') === active);
    });

    if (active === 'schools') {
      SchoolsDataMaster.redraw();
      loadDashboardStats();
    } else if (active === 'users') {
      UsersPage.loadUsers();
    }
  }

  return {
    init() {
      window.addEventListener('hashchange', () => {
        const hash = window.location.hash.replace('#', '');
        updateView(hash);
      });

      document.querySelectorAll('.page-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const target = btn.getAttribute('data-page');
          this.navigate(target);
        });
      });

      const initial = window.location.hash.replace('#', '') || 'schools';
      updateView(initial);
    },

    navigate(pageId) {
      window.location.hash = pageId;
    }
  };
})();

// ══════════════════════════════════════════════════════════════════
// 📈 Global Stats & Helpers
// ══════════════════════════════════════════════════════════════════
async function loadDashboardStats() {
  try {
    let data = null;
    if (!isStaticHost) {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) data = await res.json();
      } catch (e) {}
    }
    if (!data) {
      data = await ClientDb.getStatsFromFirestore();
    }
    if (!data) return;

    const totalEl = document.getElementById('stat-total-schools');
    if (totalEl) totalEl.textContent = data.totalSchools ?? 0;

    const distEl = document.getElementById('stat-districts');
    if (distEl) distEl.textContent = data.totalDistricts ?? 0;

    const grantEl = document.getElementById('stat-grant-aid') || document.getElementById('stat-higher-sec');
    if (grantEl) grantEl.textContent = data.grantInAidCount ?? data.higherSecCount ?? 0;

    const govtEl = document.getElementById('stat-government') || document.getElementById('stat-primary');
    if (govtEl) govtEl.textContent = data.governmentCount ?? data.primarySecCount ?? 0;
  } catch (e) {
    console.error('Failed to load dashboard stats:', e);
  }
}

async function loadFilterDropdownOptions() {
  try {
    const districtList = Object.keys(districtsTalukas).sort();

    const distSelect = document.getElementById('filter-district-select');
    if (distSelect) {
      distSelect.innerHTML = '<option value="">All Districts</option>';
      districtList.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        distSelect.appendChild(opt);
      });
    }

    const formDistrict = document.getElementById('field-Sch_District');
    if (formDistrict) {
      formDistrict.innerHTML = '<option value="">-- Select District --</option>';
      districtList.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        formDistrict.appendChild(opt);
      });

      formDistrict.addEventListener('change', (e) => {
        populateTalukasForDistrict(e.target.value);
      });
    }
  } catch (err) {
    console.error('Error populating filters:', err);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toastId = 'toast-' + Date.now();
  const bgClass = type === 'danger' ? 'bg-danger text-white' :
                  type === 'success' ? 'bg-success text-white' :
                  type === 'warning' ? 'bg-warning text-dark' : 'bg-primary text-white';

  const iconClass = type === 'danger' ? 'bi-exclamation-triangle-fill' :
                    type === 'success' ? 'bi-check-circle-fill' :
                    type === 'warning' ? 'bi-exclamation-circle-fill' : 'bi-info-circle-fill';

  const toastHtml = `
    <div id="${toastId}" class="toast align-items-center ${bgClass} border-0 shadow" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body d-flex align-items-center">
          <i class="bi ${iconClass} me-2 fs-5"></i>
          <div>${message}</div>
        </div>
        <button type="button" class="btn-close ${type === 'warning' ? '' : 'btn-close-white'} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', toastHtml);
  const toastEl = document.getElementById(toastId);
  const bsToast = new bootstrap.Toast(toastEl, { delay: 4000 });
  bsToast.show();

  toastEl.addEventListener('hidden.bs.toast', () => {
    toastEl.remove();
  });
}

// ══════════════════════════════════════════════════════════════════
// 🚀 Application Entry Point
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  loadDashboardStats();

  const loginModal = new bootstrap.Modal(document.getElementById('modal-login'));
  document.getElementById('btn-logout-main').addEventListener('click', () => {
    if (AppAuth.getUser()) {
      AppAuth.logout();
    } else {
      loginModal.show();
    }
  });

  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error-alert');
    try {
      await AppAuth.login(u, p);
      loginModal.hide();
      showToast(`Welcome back, ${u}!`, 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('d-none');
    }
  });

  document.getElementById('schools-btn-add')?.addEventListener('click', () => {
    SchoolFormAndDetailModal.showAdd();
  });

  document.getElementById('filter-district-select')?.addEventListener('change', () => {
    SchoolsDataMaster.refreshTable();
  });
  document.getElementById('filter-type-select')?.addEventListener('change', () => {
    SchoolsDataMaster.refreshTable();
  });

  // Action Bar Buttons
  document.getElementById('schools-btn-export-excel')?.addEventListener('click', () => {
    SchoolsDataMaster.exportToExcel();
  });
  document.getElementById('schools-btn-show-sel')?.addEventListener('click', () => {
    SchoolsDataMaster.toggleSelected();
  });
  document.getElementById('schools-btn-columns')?.addEventListener('click', () => {
    SchoolsDataMaster.showColumns();
  });
  document.getElementById('schools-btn-clear')?.addEventListener('click', () => {
    SchoolsDataMaster.clear();
  });
  document.getElementById('schools-search')?.addEventListener('input', (e) => {
    SchoolsDataMaster.search(e.target.value);
  });

  // UDISE Sandbox Mode Switches
  document.getElementById('btn-tab-mode-get')?.addEventListener('click', () => {
    UDISEApiPage.setMode('GET');
  });
  document.getElementById('btn-tab-mode-post')?.addEventListener('click', () => {
    UDISEApiPage.setMode('POST');
  });

  // Initialize components
  await AppAuth.init();
  await loadFilterDropdownOptions();
  SchoolsDataMaster.init();
  SchoolFormAndDetailModal.init();
  UDISEApiPage.init();
  UsersPage.init();
  AppRouter.init();
  loadDashboardStats();
});

// Expose modules to window for inline onclick handlers
window.SchoolsDataMaster = SchoolsDataMaster;
window.SchoolFormAndDetailModal = SchoolFormAndDetailModal;
window.UDISEApiPage = UDISEApiPage;
window.AppAuth = AppAuth;
window.AppRouter = AppRouter;
window.populateTalukasForDistrict = populateTalukasForDistrict;
