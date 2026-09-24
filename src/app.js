/**
 * SMDb - School Master Database
 * Architecture: Multipage SPA with Tabulator Data Management
 */

import districtsTalukas from './data/districts_talukas.json';

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
        const res = await fetch('/api/auth/me', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const data = await res.json();
        if (data.user) {
          currentUser = data.user;
          currentRole = data.user.role;
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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      token = data.token;
      currentUser = data.user;
      currentRole = data.user.role;
      localStorage.setItem('smdb_token', token);

      this.renderUserBadge();
      SchoolsDataMaster.refreshTable();
      UsersPage.loadUsers();
      return data.user;
    },

    async logout() {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
      token = '';
      currentUser = null;
      currentRole = 'guest';
      localStorage.removeItem('smdb_token');

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
    return `
      <div class="d-flex align-items-center justify-content-center gap-1" onclick="event.stopPropagation()">
        <button type="button" class="btn-view-row" title="View Details" onclick="event.stopPropagation(); SchoolsDataMaster.viewRow(${row.id}, event)">👁️</button>
        ${isAdmin ? `<button type="button" class="btn-edit-row" title="Edit School" onclick="event.stopPropagation(); SchoolsDataMaster.editRow(${row.id}, event)">✏️</button>` : ''}
        ${isAdmin ? `<button type="button" class="btn-delete-row" title="Delete School" onclick="event.stopPropagation(); SchoolsDataMaster.deleteRowPrompt(${row.id}, event)">🗑️</button>` : ''}
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
    const place = row.Sch_Place || row.Sch_Address || '';
    return `
      <div>
        <div class="fw-bold text-dark text-truncate" title="${name}">${name}</div>
        <small class="text-muted text-truncate d-block" style="font-size: 0.72rem;">${place ? place : ''}</small>
      </div>
    `;
  }

  function fmtType(cell) {
    const row = cell.getRow().getData();
    const v = cell.getValue() || row.Sch_Type || row.Type || '';
    if (!v) return '<span class="text-muted">—</span>';
    if (v === 'Grant in Aid') return `<span class="pill pill-blue">Grant in Aid</span>`;
    if (v === 'Government') return `<span class="pill pill-green">Government</span>`;
    if (v === 'Private') return `<span class="pill pill-amber">Private</span>`;
    return `<span class="pill pill-grey">${v}</span>`;
  }

  // ══════════════════════════════════════════
  // 🔒 Column Selector
  // ══════════════════════════════════════════
  function buildColumnCheckboxes() {
    if (!table) return '';

    return table.getColumns()
      .filter(col => {
        const f = col.getField();
        return f && f !== 'ACTIONS' && f !== '#' && f !== '_rowNum';
      })
      .map((col, i) => {
        const field = col.getField();
        const title = col.getDefinition().title;
        const visible = col.isVisible();

        return `
        <label class="col-selector-item">
          <input class="form-check-input col-vis-chk m-0"
            type="checkbox"
            id="col_chk_${i}"
            data-field="${field}"
            ${visible ? 'checked' : ''}>
          <span>${title}</span>
        </label>`;
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
      // Additional columns (toggleable via ⊞ Columns)
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
                this.checked ? r.select() : r.deselect();
              }
            });
          });
          return headerCheckbox;
        },
        formatter: 'rowSelection',
        headerSort: false,
        cellClick: (e, cell) => cell.getRow().toggleSelect(),
      },

      columnDefaults: {
        resizable: 'header',
      },

      columns: buildColumns(),
    });

    table.on('tableBuilt', () => {
      table.on('dataLoaded', () => {
        refreshCounts();
        loadDashboardStats();
      });
      table.on('dataFiltered', refreshCounts);
      table.on('rowSelectionChanged', refreshCounts);
      refreshCounts();
      loadDashboardStats();
    });
  }

  function destroy() {
    if (table) {
      table.destroy();
      table = null;
    }
  }

  // ════════════════════════════════════════
  // 🔢 Counts
  // ════════════════════════════════════════
  function refreshCounts() {
    setTimeout(() => {
      if (!table) return;

      const showing = table.getDataCount('active');
      const total = table.getDataCount();
      const selected = table.getSelectedRows().length;

      const countEl = $('schools-rec-count');
      if (countEl) {
        countEl.textContent = showingSelected
          ? `${showing} of ${total} (selection)`
          : `${showing} of ${total} records`;
      }

      const badge = $('schools-sel-badge');
      if (badge) {
        badge.textContent = selected;
        badge.classList.toggle('visible', selected > 0);
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
      const res = await fetch(`/api/schools/${id}`);
      const school = await res.json();
      if (!res.ok) throw new Error(school.error || 'Failed to fetch details');
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
      const res = await fetch(`/api/schools/${id}`);
      const school = await res.json();
      if (!res.ok) throw new Error(school.error || 'Failed to fetch school');
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
      fetch(`/api/schools/${id}`)
        .then(res => res.json())
        .then(school => {
          document.getElementById('delete-school-name').textContent = school.Sch_Name;
          document.getElementById('delete-school-udise').textContent = (school.Sch_UDISE || '').replace(/#/g, '');
          deleteModal.show();
        })
        .catch(err => showToast(err.message, 'danger'));
    },

    async handleFormSubmit(e) {
      e.preventDefault();
      if (!AppAuth.isAdmin()) {
        showToast('Admin role required.', 'danger');
        return;
      }

      const alertEl = document.getElementById('school-form-alert');
      const submitBtn = document.getElementById('btn-save-school');

      const payload = {};
      ALL_FIELDS.forEach(f => {
        const el = document.getElementById(`field-${f}`);
        if (el) payload[f] = el.value.trim();
      });

      const selectedType = document.getElementById('field-Sch_Type')?.value || 'Grant in Aid';
      payload.Sch_Type = selectedType;
      payload.Type = selectedType;

      if (!payload.Sch_UDISE) {
        alertEl.textContent = 'School UDISE code is required.';
        alertEl.classList.remove('d-none');
        return;
      }
      if (!payload.Sch_Name) {
        alertEl.textContent = 'School Name is required.';
        alertEl.classList.remove('d-none');
        return;
      }

      // Prefix "#" to Sch_UDISE and Account_No before saving data
      // so Excel export preserves text and prevents dropping leading zeros
      const cleanUdise = payload.Sch_UDISE.replace(/#/g, '').trim();
      payload.Sch_UDISE = '#' + cleanUdise;

      if (payload.Account_No) {
        const cleanAcc = payload.Account_No.replace(/#/g, '').trim();
        payload.Account_No = cleanAcc ? '#' + cleanAcc : '';
      }

      // Ensure Std_From and Std_To are numeric (e.g. "1" instead of "Class 1")
      if (payload.Std_From) {
        payload.Std_From = payload.Std_From.replace(/^Class\s*/i, '').trim();
      }
      if (payload.Std_To) {
        payload.Std_To = payload.Std_To.replace(/^Class\s*/i, '').trim();
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

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
        if (!res.ok) throw new Error(data.error || 'Failed to save');

        formModal.hide();
        SchoolsDataMaster.refreshTable();
        loadDashboardStats();
        showToast(data.message || 'School record saved successfully!', 'success');
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
        const res = await fetch(`/api/schools/${pendingDeleteId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${AppAuth.getToken()}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Delete failed');

        deleteModal.hide();
        SchoolsDataMaster.refreshTable();
        loadDashboardStats();
        showToast(data.message || 'School permanently deleted.', 'success');
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
        if (curlSnippet) curlSnippet.textContent = 'curl -X GET "http://localhost:3000/api/schools/udise/24070101201"';
      } else {
        postBtn?.classList.add('active');
        getBtn?.classList.remove('active');
        postContainer?.classList.remove('d-none');
        if (actionBtnText) actionBtnText.textContent = 'Sync / Upsert Record';
        if (methodLabel) methodLabel.innerHTML = '<i class="bi bi-cloud-arrow-up-fill text-success"></i>';
        if (curlSnippet) curlSnippet.textContent = `curl -X POST "http://localhost:3000/api/schools/udise/24070101201" -H "Content-Type: application/json" -d '{"Sch_Principal":"New Principal Name"}'`;
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
        let res;
        if (currentMode === 'GET') {
          res = await fetch(`/api/schools/udise/${encodeURIComponent(udise)}`);
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

          res = await fetch(`/api/schools/udise/${encodeURIComponent(udise)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
          });
        }

        const elapsed = Math.round(performance.now() - start);
        const data = await res.json();

        if (res.ok) {
          const schoolData = data.data || data;
          statusBadge.className = 'pill pill-green';
          statusBadge.innerHTML = `<i class="bi bi-check2-circle me-1"></i>${res.status} OK (${elapsed}ms)${data.action ? ` - ${data.action.toUpperCase()}` : ''}`;

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
            showToast(data.message || 'School synced to SMDb successfully!', 'success');
            // Refresh main table if active
            if (typeof SchoolsDataMaster !== 'undefined' && SchoolsDataMaster.redraw) {
              SchoolsDataMaster.redraw();
            }
          }
        } else {
          statusBadge.className = 'pill pill-red';
          statusBadge.innerHTML = `<i class="bi bi-x-circle me-1"></i>${res.status} ${res.statusText} (${elapsed}ms)`;
          previewCard.classList.add('d-none');
        }

        jsonOutput.textContent = JSON.stringify(data, null, 2);
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
        const res = await fetch('/api/users', {
          headers: { 'Authorization': `Bearer ${AppAuth.getToken()}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load');

        if (!data.users || data.users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted">No users found.</td></tr>';
          return;
        }

        tbody.innerHTML = '';
        const current = AppAuth.getUser();
        data.users.forEach(u => {
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
            <td class="small text-muted">${new Date(u.created_at).toLocaleDateString()}</td>
            <td>
              <button class="btn btn-outline-danger btn-sm py-0 btn-del-usr" data-id="${u.id}" ${isSelf || isPrimaryAdmin ? 'disabled title="Cannot delete this user"' : 'title="Delete user"'}>
                <i class="bi bi-trash"></i>
              </button>
            </td>
          `;
          tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-del-usr').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const uid = e.currentTarget.getAttribute('data-id');
            if (!confirm('Are you sure you want to delete this user account?')) return;
            try {
              const delRes = await fetch(`/api/users/${uid}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${AppAuth.getToken()}` }
              });
              const delData = await delRes.json();
              if (!delRes.ok) throw new Error(delData.error);
              showToast(delData.message || 'User removed', 'success');
              UsersPage.loadUsers();
            } catch (delErr) {
              showToast(delErr.message, 'danger');
            }
          });
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
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AppAuth.getToken()}`
          },
          body: JSON.stringify({ username, password, role })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create user');

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
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();
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
    // 1. Districts from districtsTalukas resource
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

    // Modal district options
    const formDistrict = document.getElementById('field-Sch_District');
    if (formDistrict) {
      formDistrict.innerHTML = '<option value="">-- Select District --</option>';
      districtList.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        formDistrict.appendChild(opt);
      });

      formDistrict.addEventListener('change', function () {
        populateTalukasForDistrict(this.value);
      });
    }

    // 2. Types
    const typeSelect = document.getElementById('filter-type-select');
    if (typeSelect) {
      typeSelect.innerHTML = `
        <option value="">All School Types</option>
        <option value="Grant in Aid">Grant in Aid</option>
        <option value="Government">Government</option>
        <option value="Private">Private</option>
      `;
    }
  } catch (e) {
    console.error('Failed to load filter dropdown options:', e);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toastEl = document.createElement('div');
  const bgClass = type === 'success' ? 'bg-success text-white' :
                  type === 'danger' ? 'bg-danger text-white' :
                  type === 'warning' ? 'bg-warning text-dark' : 'bg-dark text-white';

  toastEl.className = `toast align-items-center ${bgClass} border-0 shadow`;
  toastEl.setAttribute('role', 'alert');
  toastEl.innerHTML = `
    <div class="d-flex">
      <div class="toast-body fw-medium">${message}</div>
      <button type="button" class="btn-close ${type === 'warning' ? '' : 'btn-close-white'} me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>
  `;
  container.appendChild(toastEl);
  const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
  toast.show();
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

// ══════════════════════════════════════════════════════════════════
// 🚀 Application Entry Point
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Load stats immediately on initial page load
  loadDashboardStats();

  // Setup login modal & handlers
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

  // Add school trigger
  document.getElementById('schools-btn-add')?.addEventListener('click', () => {
    SchoolFormAndDetailModal.showAdd();
  });

  // Table quick filters
  document.getElementById('filter-district-select')?.addEventListener('change', () => {
    SchoolsDataMaster.refreshTable();
  });
  document.getElementById('filter-type-select')?.addEventListener('change', () => {
    SchoolsDataMaster.refreshTable();
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
window.AppAuth = AppAuth;
window.AppRouter = AppRouter;
