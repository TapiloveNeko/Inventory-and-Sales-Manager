const InventoryApp = {
  STORAGE_KEY: 'inventory-management-data',
  WIDTHS_KEY: 'inventory-column-widths-v3',
  THEME_KEY: 'inventory-theme',
  FIRESTORE_COLLECTION: 'inventory',
  FIRESTORE_DOC: 'rows',
  MIN_COL_WIDTH: 40,
  MAX_COL_WIDTH: 600,
  RESIZE_EDGE_PX: 8,
  MAX_IMAGES: 2,
  SAVE_DEBOUNCE_MS: 800,
  UNDO_DELETE_LIMIT: 20,

  COLUMNS: [
    { key: 'no', label: 'No', width: 48, sticky: 'no', kind: 'index' },
    { key: 'managementNo', label: '管理番号', width: 100, sticky: 'id', kind: 'digits' },
    { key: 'listingDate', label: '出品日', width: 130, kind: 'date' },
    { key: 'winningBidDate', label: '落札日', width: 130, kind: 'date' },
    { key: 'paymentDate', label: '入金日', width: 130, kind: 'date' },
    { key: 'itemName', label: '品名', width: 240, kind: 'textarea', thClass: 'col-name' },
    { key: 'images', label: '画像（2枚まで）', width: 230, kind: 'images', thClass: 'col-images', minWidth: 230 },
    { key: 'purchasePrice', label: '仕入価格', width: 110, kind: 'money', thClass: 'col-money' },
    { key: 'purchaseShipping', label: '仕入送料', width: 110, kind: 'money', thClass: 'col-money' },
    { key: 'purchaseTotal', label: '仕入合計', width: 110, kind: 'calcPurchase', thClass: 'col-money col-calc' },
    { key: 'sellingPrice', label: '売買価格', width: 110, kind: 'money', thClass: 'col-money' },
    { key: 'sellingShipping', label: '輸出送料', width: 110, kind: 'money', thClass: 'col-money' },
    { key: 'size', label: '梱包寸法', width: 130, kind: 'textarea' },
    { key: 'bodyWeight', label: '本体重量', width: 100, kind: 'unit', unit: 'g' },
    { key: 'weight', label: '梱包重量', width: 100, kind: 'unit', unit: 'g' },
    { key: 'profitLoss', label: '粗利', width: 110, kind: 'calcProfit', thClass: 'col-money col-calc' },
    { key: 'buyerCountry', label: '落札者の国名', width: 140, kind: 'textarea' },
    { key: 'buyerName', label: '落札者名', width: 140, kind: 'textarea' },
    { key: 'actions', label: '操作', width: 56, kind: 'actions', thClass: 'col-actions' },
  ],

  SUMMARY: [
    { id: 'totalCount', label: '登録件数', value: (rows) => String(rows.length) },
    { id: 'totalPurchase', label: '仕入合計', value: (rows) => InventoryApp.formatYen(InventoryApp.sum(rows, (r) => InventoryApp.calcPurchaseTotal(r))) },
    {
      id: 'totalSales',
      label: '売上合計',
      value: (rows) =>
        InventoryApp.formatYen(
          InventoryApp.sum(rows, (r) => InventoryApp.parseNumber(r.sellingPrice) + InventoryApp.parseNumber(r.sellingShipping))
        ),
    },
    {
      id: 'totalProfit',
      label: '粗利合計',
      value: (rows) => {
        const total = InventoryApp.sumProfitLoss(rows);
        return (total >= 0 ? '+' : '') + InventoryApp.formatYen(total);
      },
      className: (rows) => {
        const total = InventoryApp.sumProfitLoss(rows);
        if (total > 0) return 'profit-positive';
        if (total < 0) return 'profit-negative';
        return '';
      },
    },
  ],

  ICONS: {
    insertAbove: '<svg class="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5L11.5 7H4.5L8 3.5z" fill="currentColor"/><path d="M3 12.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    insertBelow: '<svg class="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 12.5L4.5 9h7L8 12.5z" fill="currentColor"/><path d="M3 3.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    trash: '<svg class="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4h10M6 4V3h4v1M5 4v9h6V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    zoom: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 7h4M7 5v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    imgAdd: '<svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  },

  rows: [],
  deleteUndoStack: [],
  deleteRedoStack: [],
  saveTimer: null,
  columnWidths: {},
  els: {},
  db: null,

  get DIGIT_FIELDS() {
    return new Set(this.COLUMNS.filter((c) => c.kind === 'digits' || c.kind === 'money' || c.kind === 'unit').map((c) => c.key));
  },

  get MONEY_FIELDS() {
    return new Set(this.COLUMNS.filter((c) => c.kind === 'money').map((c) => c.key));
  },

  get DEFAULT_WIDTHS() {
    return Object.fromEntries(this.COLUMNS.map((c) => [c.key, c.width]));
  },

  get EXPORT_COLUMNS() {
    const calcGet = {
      calcPurchase: (r) => this.calcPurchaseTotal(r),
      calcProfit: (r) => this.calcProfitLoss(r),
    };

    return this.COLUMNS.flatMap((col) => {
      if (col.kind === 'actions') return [];
      if (col.kind === 'index') return [{ header: col.label, get: (_r, i) => i + 1 }];
      if (col.kind === 'calcPurchase' || col.kind === 'calcProfit') {
        return [{ header: col.label, type: 'number', get: calcGet[col.kind] }];
      }
      if (col.kind === 'images') {
        return Array.from({ length: this.MAX_IMAGES }, (_, i) => ({
          header: `画像${i + 1}`,
          kind: 'image',
          imageIndex: i,
          width: 14,
        }));
      }
      if (col.kind === 'unit') return [{ header: `${col.label}(${col.unit})`, type: 'number', key: col.key }];
      if (col.kind === 'money' || col.kind === 'digits') {
        return [{ header: col.sub ? `${col.label}${col.sub}` : col.label, type: 'number', key: col.key }];
      }
      return [{ header: col.label, key: col.key }];
    });
  },

  // =========================================================
  // Firebase 初期化
  // =========================================================
  initFirebase() {
    try {
      if (typeof firebaseConfig === 'undefined') {
        console.error('firebase-config.js が読み込まれていないか、firebaseConfig が未定義です');
        return false;
      }
      const app = firebase.initializeApp(firebaseConfig);
      this.db = firebase.firestore(app);
      return true;
    } catch (err) {
      console.error('Firebase初期化エラー:', err);
      return false;
    }
  },

  // =========================================================
  // Firestore 保存
  // =========================================================
  saveToStorage() {
    this.setSaveIndicator('saving');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      if (!this.db) {
        try {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.rows));
          this.setSaveIndicator('saved');
        } catch (err) {
          console.error('localStorage保存エラー:', err);
          this.setSaveIndicator('error');
        }
        return;
      }

      try {
        await this.db
          .collection(this.FIRESTORE_COLLECTION)
          .doc(this.FIRESTORE_DOC)
          .set({ rows: this.rows });
        this.setSaveIndicator('saved');
      } catch (err) {
        console.error('Firestore保存エラー:', err);
        this.setSaveIndicator('error');
      }
    }, this.SAVE_DEBOUNCE_MS);
  },

  // =========================================================
  // Firestore 読み込み
  // =========================================================
  async loadFromStorage() {
    if (!this.db) {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((row) => ({
          ...row,
          images: Array.isArray(row.images) ? row.images.slice(0, this.MAX_IMAGES) : [],
        }));
      } catch {
        return [];
      }
    }

    try {
      const doc = await this.db
        .collection(this.FIRESTORE_COLLECTION)
        .doc(this.FIRESTORE_DOC)
        .get();

      if (!doc.exists) return [];
      const data = doc.data();
      if (!Array.isArray(data?.rows)) return [];
      return data.rows.map((row) => ({
        ...row,
        images: Array.isArray(row.images) ? row.images.slice(0, this.MAX_IMAGES) : [],
      }));
    } catch (err) {
      console.error('Firestore読み込みエラー:', err);
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
  },

  async init() {
    this.cacheElements();
    this.buildSummary();
    this.buildTableHead();
    this.initTheme();
    this.columnWidths = this.loadColumnWidths();
    this.initColumnResize();
    this.initStickySync();
    this.initLightbox();
    this.bindHeaderActions();

    this.initFirebase();
    this.setSaveIndicator('loading');
    this.rows = await this.loadFromStorage();
    this.setSaveIndicator('loaded');
    this.updateHistoryButtons();
    this.renderTable();
  },

  $(sel, root = document) {
    return root.querySelector(sel);
  },

  cacheElements() {
    this.els = {
      colgroup: this.$('#tableColgroup'),
      headRow: this.$('#tableHeadRow'),
      tbody: this.$('#tableBody'),
      table: this.$('#inventoryTable'),
      wrapper: this.$('.table-wrapper'),
      summaryBar: this.$('#summaryBar'),
      saveIndicator: this.$('#saveIndicator'),
      lightbox: this.$('#imageLightbox'),
      lightboxImg: this.$('#imageLightboxImg'),
      themeIcon: this.$('#themeIcon'),
      undoDeleteBtn: this.$('#undoDeleteBtn'),
      redoDeleteBtn: this.$('#redoDeleteBtn'),
    };
  },

  bindHeaderActions() {
    const map = {
      undoDeleteBtn: () => this.undoDeleteRow(),
      redoDeleteBtn: () => this.redoDeleteRow(),
      addRowBtn: () => this.addRow(),
      exportExcelBtn: () => this.exportToExcel(),
      resetColWidthsBtn: () => this.resetColumnWidths(),
      themeToggle: () => this.toggleTheme(),
    };
    Object.entries(map).forEach(([id, fn]) => {
      document.getElementById(id)?.addEventListener('click', fn);
    });
  },

  buildSummary() {
    const bar = this.els.summaryBar;
    if (!bar) return;
    bar.innerHTML = this.SUMMARY.map(
      (item) => `
        <div class="summary-item">
          <span class="summary-label">${item.label}</span>
          <span class="summary-value" id="${item.id}">—</span>
        </div>`
    ).join('');
  },

  buildTableHead() {
    const { colgroup, headRow } = this.els;
    if (!colgroup || !headRow) return;

    colgroup.innerHTML = '';
    headRow.innerHTML = '';

    this.COLUMNS.forEach((col) => {
      const colEl = document.createElement('col');
      colEl.dataset.col = col.key;
      colgroup.appendChild(colEl);

      const th = document.createElement('th');
      th.dataset.col = col.key;
      th.className = [col.sticky && 'col-sticky', col.sticky && `col-${col.sticky}`, col.thClass].filter(Boolean).join(' ');

      const label = document.createElement('span');
      label.className = 'th-label';
      label.textContent = col.label;
      if (col.sub) {
        const sub = document.createElement('span');
        sub.className = 'th-sub';
        sub.textContent = col.sub;
        label.appendChild(sub);
      }
      th.appendChild(label);
      headRow.appendChild(th);
    });
  },

  initTheme() {
    this.applyTheme(localStorage.getItem(this.THEME_KEY) || 'dark');
  },

  applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(this.THEME_KEY, theme);
    if (this.els.themeIcon) {
      this.els.themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  },

  toggleTheme() {
    const current = document.documentElement.dataset.theme || 'dark';
    this.applyTheme(current === 'dark' ? 'light' : 'dark');
  },

  loadColumnWidths() {
    const defaults = { ...this.DEFAULT_WIDTHS };
    try {
      const raw = localStorage.getItem(this.WIDTHS_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaults;

      const merged = { ...defaults, ...parsed };
      this.COLUMNS.forEach(({ key, minWidth }) => {
        const min = minWidth ?? this.MIN_COL_WIDTH;
        const value = merged[key];
        if (!Number.isFinite(value) || value < min || value > this.MAX_COL_WIDTH) {
          merged[key] = defaults[key];
        }
      });
      return merged;
    } catch {
      return defaults;
    }
  },

  saveColumnWidths() {
    try {
      localStorage.setItem(this.WIDTHS_KEY, JSON.stringify(this.columnWidths));
    } catch (err) {
      console.error('列幅の保存に失敗しました:', err);
    }
  },

  getColEl(key) {
    return this.$(`#tableColgroup col[data-col="${key}"]`);
  },

  syncTableWidth() {
    const total = this.COLUMNS.reduce((sum, { key }) => sum + (this.columnWidths[key] ?? this.DEFAULT_WIDTHS[key]), 0);
    if (this.els.table) this.els.table.style.width = `${total}px`;
  },

  setColumnWidth(key, widthPx) {
    const col = this.COLUMNS.find((c) => c.key === key);
    const min = col?.minWidth ?? this.MIN_COL_WIDTH;
    const width = Math.max(min, Math.min(this.MAX_COL_WIDTH, Math.round(widthPx)));
    this.columnWidths[key] = width;
    const colEl = this.getColEl(key);
    if (colEl) {
      colEl.style.width = `${width}px`;
      colEl.style.minWidth = `${width}px`;
      colEl.style.maxWidth = `${width}px`;
    }
    this.syncTableWidth();
    if (key === 'no') this.updateStickyPositions();
  },

  applyColumnWidths() {
    this.COLUMNS.forEach(({ key }) => this.setColumnWidth(key, this.columnWidths[key] ?? this.DEFAULT_WIDTHS[key]));
    this.updateStickyPositions();
  },

  updateStickyPositions() {
    const noCell = this.$('thead th.col-no, tbody td.col-no', this.els.table);
    const measured = noCell?.getBoundingClientRect().width;
    const fallback = this.columnWidths.no ?? this.DEFAULT_WIDTHS.no;
    const width = measured > 0 ? measured : fallback;
    document.documentElement.style.setProperty('--sticky-id-left', `${Math.ceil(width)}px`);
  },

  updateHeaderHeight() {
    const h = document.querySelector('.app-header')?.getBoundingClientRect().height ?? 0;
    document.documentElement.style.setProperty('--app-header-height', `${Math.ceil(h)}px`);
  },

  initStickySync() {
    const { table } = this.els;
    if (!table) return;
    this.updateHeaderHeight();
    window.addEventListener('resize', () => {
      this.updateHeaderHeight();
      this.updateStickyPositions();
    }, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.updateStickyPositions()).observe(table);
      const header = document.querySelector('.app-header');
      if (header) new ResizeObserver(() => this.updateHeaderHeight()).observe(header);
    }
  },

  isNearResizeEdge(th, clientX) {
    const { right } = th.getBoundingClientRect();
    return clientX >= right - this.RESIZE_EDGE_PX;
  },

  initColumnResize() {
    this.els.headRow?.querySelectorAll('th[data-col]').forEach((th) => {
      th.addEventListener('mousedown', (e) => {
        const key = th.dataset.col;
        if (!key || !this.isNearResizeEdge(th, e.clientX)) return;
        this.startColumnResize(e, key, th);
      });
      th.addEventListener('mousemove', (e) => {
        th.classList.toggle('is-col-resize-hover', this.isNearResizeEdge(th, e.clientX));
      });
      th.addEventListener('mouseleave', () => th.classList.remove('is-col-resize-hover'));
    });
  },

  startColumnResize(e, key, th) {
    e.preventDefault();
    e.stopPropagation();

    const col = this.getColEl(key);
    if (!col) return;

    const startWidth = this.columnWidths[key] ?? this.DEFAULT_WIDTHS[key] ?? th.getBoundingClientRect().width;
    const startX = e.clientX;
    th.classList.add('is-col-resizing');
    document.body.classList.add('col-resizing');

    const onMove = (ev) => {
      this.setColumnWidth(key, startWidth + ev.clientX - startX);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('col-resizing');
      th.classList.remove('is-col-resizing');
      this.saveColumnWidths();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  resetColumnWidths() {
    this.columnWidths = { ...this.DEFAULT_WIDTHS };
    this.applyColumnWidths();
    this.saveColumnWidths();
  },

  formatYen(value) {
    return `¥${(Number(value) || 0).toLocaleString('ja-JP')}`;
  },

  formatSignedYen(value) {
    if (value === null) return '—';
    return `${value >= 0 ? '+' : ''}${this.formatYen(value)}`;
  },

  parseNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  },

  sanitizeDigits(value) {
    return String(value ?? '').replace(/\D/g, '');
  },

  sum(rows, fn) {
    return rows.reduce((total, row) => total + fn(row), 0);
  },

  sumProfitLoss(rows) {
    return rows.reduce((total, row) => {
      const pl = this.calcProfitLoss(row);
      return pl === null ? total : total + pl;
    }, 0);
  },

  calcPurchaseTotal(row) {
    return this.parseNumber(row.purchasePrice) + this.parseNumber(row.purchaseShipping);
  },

  calcProfitLoss(row) {
    const purchase = this.calcPurchaseTotal(row);
    const revenue = this.parseNumber(row.sellingPrice) + this.parseNumber(row.sellingShipping);
    if (purchase === 0 && revenue === 0) return null;
    return revenue - purchase;
  },

  createEmptyRow() {
    const row = { id: crypto.randomUUID(), images: [] };
    this.COLUMNS.forEach(({ key, kind }) => {
      if (!['index', 'calcPurchase', 'calcProfit', 'actions', 'images'].includes(kind)) {
        row[key] = '';
      }
    });
    return row;
  },

  setSaveIndicator(state) {
    const el = this.els.saveIndicator;
    if (!el) return;
    el.classList.remove('is-saving', 'is-saved');
    if (state === 'loading') {
      el.textContent = '読み込み中...';
      el.classList.add('is-saving');
    } else if (state === 'loaded') {
      el.textContent = '';
    } else if (state === 'saving') {
      el.textContent = '保存中...';
      el.classList.add('is-saving');
    } else if (state === 'saved') {
      el.textContent = '保存済み';
      el.classList.add('is-saved');
    } else {
      el.textContent = '保存エラー（接続またはデータ容量を確認）';
    }
  },

  updateSummary() {
    this.SUMMARY.forEach((item) => {
      const el = document.getElementById(item.id);
      if (!el) return;
      el.textContent = item.value(this.rows);
      if (item.className) {
        el.classList.remove('profit-positive', 'profit-negative');
        const cls = item.className(this.rows);
        if (cls) el.classList.add(cls);
      }
    });
  },

  setProfitLossCell(cell, row) {
    const pl = this.calcProfitLoss(row);
    cell.textContent = this.formatSignedYen(pl);
    cell.classList.remove('is-profit', 'is-loss', 'is-neutral');
    cell.classList.add(pl === null ? 'is-neutral' : pl >= 0 ? 'is-profit' : 'is-loss');
  },

  createInput(field, { digits = false, type = 'text', className = 'field-input' } = {}) {
    const input = document.createElement('input');
    input.type = type;
    input.className = className;
    input.dataset.field = field;
    if (digits) {
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.classList.add('field-number');
    }
    return input;
  },

  createAffixInput(field, affix, position = 'prefix') {
    const wrap = document.createElement('div');
    wrap.className = 'affix-input-wrap';
    const input = this.createInput(field, { digits: true });
    const span = document.createElement('span');
    span.className = 'input-affix';
    span.textContent = affix;
    if (position === 'prefix') {
      wrap.append(span, input);
    } else {
      wrap.append(input, span);
    }
    return wrap;
  },

  updateRowCalcs(tr, row) {
    tr.querySelector('.purchase-total').textContent = this.formatYen(this.calcPurchaseTotal(row));
    this.setProfitLossCell(tr.querySelector('.profit-loss'), row);
  },

  createCalcCell(className) {
    const span = document.createElement('span');
    span.className = `calc-value ${className}`;
    return span;
  },

  createCell(col) {
    const td = document.createElement('td');
    td.dataset.col = col.key;
    if (col.sticky) td.classList.add('col-sticky', `col-${col.sticky}`);
    if (col.thClass) col.thClass.split(' ').forEach((c) => td.classList.add(c));

    switch (col.kind) {
      case 'index':
        td.classList.add('row-number');
        break;
      case 'digits':
        td.appendChild(this.createInput(col.key, { digits: true }));
        break;
      case 'date':
        td.appendChild(this.createInput(col.key, { type: 'date' }));
        break;
      case 'text':
        td.appendChild(this.createInput(col.key));
        break;
      case 'textarea': {
        const ta = document.createElement('textarea');
        ta.className = 'field-input field-textarea';
        ta.dataset.field = col.key;
        ta.rows = 1;
        td.appendChild(ta);
        break;
      }
      case 'money':
        td.appendChild(this.createAffixInput(col.key, '¥', 'prefix'));
        break;
      case 'unit':
        td.appendChild(this.createAffixInput(col.key, col.unit, 'suffix'));
        break;
      case 'calcPurchase':
        td.appendChild(this.createCalcCell('purchase-total'));
        break;
      case 'calcProfit':
        td.appendChild(this.createCalcCell('profit-loss'));
        break;
      case 'images':
        td.innerHTML = `
          <div class="image-upload-area" data-field="images">
            <div class="image-slots"></div>
            <input type="file" class="image-input" accept="image/*" multiple hidden>
          </div>`;
        break;
      case 'actions':
        td.innerHTML = `
          <div class="row-actions">
            <button type="button" class="btn btn-icon btn-insert-above" title="上に行を挿入" aria-label="上に行を挿入">${this.ICONS.insertAbove}</button>
            <button type="button" class="btn btn-icon btn-insert-below" title="下に行を挿入" aria-label="下に行を挿入">${this.ICONS.insertBelow}</button>
            <button type="button" class="btn btn-icon btn-delete" title="行を削除" aria-label="行を削除">${this.ICONS.trash}</button>
          </div>`;
        break;
      default:
        break;
    }
    return td;
  },

  createRowElement(row, index) {
    const tr = document.createElement('tr');
    tr.className = 'data-row';

    this.COLUMNS.forEach((col) => tr.appendChild(this.createCell(col)));

    tr.querySelector('.row-number').textContent = String(index + 1);

    tr.querySelectorAll('.field-input').forEach((input) => {
      const field = input.dataset.field;
      const raw = row[field];
      if (raw === undefined) return;

      if (this.DIGIT_FIELDS.has(field)) {
        input.value = this.sanitizeDigits(raw);
        row[field] = input.value;
      } else {
        input.value = raw;
      }
    });

    this.updateRowCalcs(tr, row);
    this.renderImageSlots(tr.querySelector('.image-slots'), row);
    this.bindRowEvents(tr, row, index);
    tr.querySelectorAll('.field-textarea').forEach((ta) => this.autoResizeTextarea(ta));

    return tr;
  },

  autoResizeTextarea(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  },

  applyDigitInput(input) {
    if (!this.DIGIT_FIELDS.has(input.dataset.field)) return;
    const sanitized = this.sanitizeDigits(input.value);
    if (input.value === sanitized) return;
    const end = input.selectionEnd;
    input.value = sanitized;
    input.setSelectionRange(Math.min(end ?? sanitized.length, sanitized.length), Math.min(end ?? sanitized.length, sanitized.length));
  },

  blockNonDigitKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  },

  handleFieldInput(tr, row, input) {
    const field = input.dataset.field;
    this.applyDigitInput(input);
    row[field] = input.value;

    if (input.classList.contains('field-textarea')) this.autoResizeTextarea(input);

    if (this.MONEY_FIELDS.has(field)) {
      this.updateRowCalcs(tr, row);
      this.updateSummary();
    }

    this.saveToStorage();
  },

  getFocusableInputs(table) {
    const skipKinds = new Set(['index', 'calcPurchase', 'calcProfit', 'actions', 'images']);
    const orderedKeys = this.COLUMNS.filter((c) => !skipKinds.has(c.kind)).map((c) => c.key);

    const inputs = [];
    table.querySelectorAll('tbody tr.data-row').forEach((tr) => {
      orderedKeys.forEach((key) => {
        const td = tr.querySelector(`td[data-col="${key}"]`);
        const el = td?.querySelector('input.field-input, textarea.field-input');
        if (el) inputs.push(el);
      });
    });
    return inputs;
  },

  getDateSection(input) {
    const sel = input.selectionStart ?? 0;
    if (sel <= 4) return 'year';
    if (sel <= 7) return 'month';
    return 'day';
  },

  moveFocus(currentInput, direction) {
    const table = this.els.table;
    if (!table) return;

    const inputs = this.getFocusableInputs(table);
    const idx = inputs.indexOf(currentInput);
    if (idx === -1) return;

    const nextIdx = idx + direction;

    if (nextIdx >= 0 && nextIdx < inputs.length) {
      inputs[nextIdx].focus();
      inputs[nextIdx].select?.();
      return;
    }

    if (direction > 0 && nextIdx >= inputs.length) {
      this.addRow();
      requestAnimationFrame(() => {
        const newInputs = this.getFocusableInputs(table);
        if (newInputs.length > idx + 1) {
          newInputs[idx + 1].focus();
          newInputs[idx + 1].select?.();
        }
      });
    }
  },

  bindRowEvents(tr, row, rowIndex) {
    tr.querySelectorAll('.field-input').forEach((input) => {
      const onChange = () => this.handleFieldInput(tr, row, input);
      input.addEventListener('input', onChange);
      input.addEventListener('change', onChange);

      if (this.DIGIT_FIELDS.has(input.dataset.field)) {
        input.addEventListener('keydown', (e) => this.blockNonDigitKey(e));
        input.addEventListener('compositionend', onChange);
        input.addEventListener('paste', (e) => {
          e.preventDefault();
          const pasted = this.sanitizeDigits(e.clipboardData.getData('text'));
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? input.value.length;
          input.value = input.value.slice(0, start) + pasted + input.value.slice(end);
          input.setSelectionRange(start + pasted.length, start + pasted.length);
          onChange();
        });
      }

      if (input.type === 'date') {
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== 'Tab') return;
          e.preventDefault();
          const direction = e.shiftKey ? -1 : 1;
          const section = this.getDateSection(input);
          if (direction > 0 && section !== 'day') {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: false }));
          } else if (direction < 0 && section !== 'year') {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: false }));
          } else {
            this.moveFocus(input, direction);
          }
        });
        return;
      }

      input.addEventListener('keydown', (e) => {
        const isTextarea = input.tagName === 'TEXTAREA';
        if (e.key === 'Enter') {
          if (isTextarea && e.shiftKey) return;
          e.preventDefault();
          this.moveFocus(input, 1);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          this.moveFocus(input, e.shiftKey ? -1 : 1);
        }
      });
    });

    tr.querySelector('.image-input')?.addEventListener('change', (e) => this.handleImageChange(e, row));
    tr.querySelector('.btn-insert-above')?.addEventListener('click', () => this.insertRowAt(rowIndex, 'above'));
    tr.querySelector('.btn-insert-below')?.addEventListener('click', () => this.insertRowAt(rowIndex, 'below'));
    tr.querySelector('.btn-delete')?.addEventListener('click', () => this.handleDeleteRow(row, rowIndex));
  },

  renderImageSlots(container, row) {
    container.innerHTML = '';

    row.images.forEach((src, i) => {
      const slot = document.createElement('div');
      slot.className = 'image-slot';
      slot.innerHTML = `
        <button type="button" class="image-preview-btn" aria-label="画像 ${i + 1} を拡大表示">
          <img src="${src}" alt="商品画像 ${i + 1}">
          <span class="image-zoom-icon">${this.ICONS.zoom}</span>
        </button>
        <button type="button" class="remove-image" aria-label="画像を削除">&times;</button>`;

      slot.querySelector('.image-preview-btn').addEventListener('click', () => this.openImagePreview(src));
      slot.querySelector('.remove-image').addEventListener('click', (ev) => {
        ev.stopPropagation();
        row.images.splice(i, 1);
        this.saveToStorage();
        this.renderTable();
      });
      container.appendChild(slot);
    });

    if (row.images.length < this.MAX_IMAGES) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'image-add-btn';
      addBtn.title = '画像を追加（最大2枚）';
      addBtn.innerHTML = `${this.ICONS.imgAdd}<span class="image-add-label">追加</span>`;
      addBtn.addEventListener('click', () => {
        container.closest('.image-upload-area').querySelector('.image-input').click();
      });
      container.appendChild(addBtn);
    }
  },

  handleImageChange(e, row) {
    const remaining = this.MAX_IMAGES - row.images.length;
    Array.from(e.target.files)
      .slice(0, remaining)
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (row.images.length < this.MAX_IMAGES) {
            row.images.push(ev.target.result);
            this.saveToStorage();
            this.renderTable();
          }
        };
        reader.readAsDataURL(file);
      });
    e.target.value = '';
  },

  cloneRow(row) {
    return JSON.parse(JSON.stringify(row));
  },

  pushRowHistory(entry) {
    this.deleteUndoStack.push(entry);
    if (this.deleteUndoStack.length > this.UNDO_DELETE_LIMIT) this.deleteUndoStack.shift();
    this.deleteRedoStack = [];
    this.updateHistoryButtons();
  },

  pushDeleteHistory(row, index, replaceOnly = false) {
    this.pushRowHistory({ action: 'delete', row: this.cloneRow(row), index, replaceOnly });
  },

  pushAddHistory(row, index) {
    this.pushRowHistory({ action: 'add', row: this.cloneRow(row), index });
  },

  updateHistoryButtons() {
    const set = (btn, enabled) => {
      if (!btn) return;
      btn.disabled = !enabled;
      btn.setAttribute('aria-disabled', String(!enabled));
    };
    set(this.els.undoDeleteBtn, this.deleteUndoStack.length > 0);
    set(this.els.redoDeleteBtn, this.deleteRedoStack.length > 0);
  },

  restoreDeletedRow(entry) {
    const row = this.cloneRow(entry.row);
    if (entry.replaceOnly && this.rows.length === 1) {
      this.rows[0] = row;
      return 0;
    }
    const insertAt = Math.min(entry.index, this.rows.length);
    this.rows.splice(insertAt, 0, row);
    return insertAt;
  },

  deleteRowForHistory(entry) {
    const idx = this.rows.findIndex((r) => r.id === entry.row.id);
    if (idx < 0) return -1;

    const replaceOnly = this.rows.length === 1;
    const snapshot = { action: 'delete', row: this.cloneRow(this.rows[idx]), index: idx, replaceOnly };

    if (replaceOnly) {
      Object.assign(this.rows[0], this.createEmptyRow(), { id: this.rows[0].id });
    } else {
      this.rows.splice(idx, 1);
    }
    return snapshot;
  },

  removeAddedRow(entry) {
    const idx = this.rows.findIndex((r) => r.id === entry.row.id);
    if (idx < 0) return -1;
    this.rows.splice(idx, 1);
    return idx;
  },

  restoreAddedRow(entry) {
    const row = this.cloneRow(entry.row);
    const insertAt = Math.min(entry.index, this.rows.length);
    this.rows.splice(insertAt, 0, row);
    return insertAt;
  },

  undoDeleteRow() {
    const entry = this.deleteUndoStack.pop();
    if (!entry) return;

    const index = entry.action === 'add' ? this.removeAddedRow(entry) : this.restoreDeletedRow(entry);
    if (index < 0) {
      this.deleteUndoStack.push(entry);
      this.updateHistoryButtons();
      return;
    }

    this.deleteRedoStack.push(entry);
    this.saveToStorage();
    try {
      this.renderTable();
    } finally {
      this.updateHistoryButtons();
    }
    this.$(`#tableBody tr.data-row:nth-child(${index + 1})`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },

  redoDeleteRow() {
    const entry = this.deleteRedoStack.pop();
    if (!entry) return;

    if (entry.action === 'add') {
      const index = this.restoreAddedRow(entry);
      this.deleteUndoStack.push(entry);
      if (this.deleteUndoStack.length > this.UNDO_DELETE_LIMIT) this.deleteUndoStack.shift();
      this.saveToStorage();
      try {
        this.renderTable();
      } finally {
        this.updateHistoryButtons();
      }
      this.$(`#tableBody tr.data-row:nth-child(${index + 1})`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    const snapshot = this.deleteRowForHistory(entry);
    if (snapshot === -1) {
      this.deleteRedoStack.push(entry);
      this.updateHistoryButtons();
      return;
    }

    this.deleteUndoStack.push(snapshot);
    if (this.deleteUndoStack.length > this.UNDO_DELETE_LIMIT) this.deleteUndoStack.shift();
    this.saveToStorage();
    try {
      this.renderTable();
    } finally {
      this.updateHistoryButtons();
    }
  },

  handleDeleteRow(row, rowIndex) {
    const replaceOnly = this.rows.length === 1;
    this.pushDeleteHistory(row, rowIndex, replaceOnly);

    if (replaceOnly) {
      Object.assign(row, this.createEmptyRow(), { id: row.id });
    } else {
      this.rows.splice(rowIndex, 1);
    }
    this.saveToStorage();
    this.renderTable();
  },

  insertRowAt(rowIndex, position) {
    const insertAt = position === 'above' ? rowIndex : rowIndex + 1;
    const row = this.createEmptyRow();
    this.rows.splice(insertAt, 0, row);
    this.pushAddHistory(row, insertAt);
    this.saveToStorage();
    this.renderTable();
    this.$(`#tableBody tr.data-row:nth-child(${insertAt + 1})`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },

  initLightbox() {
    const { lightbox } = this.els;
    if (!lightbox) return;

    const close = () => this.closeImagePreview();
    document.getElementById('imageLightboxClose')?.addEventListener('click', close);
    lightbox.querySelectorAll('[data-close-lightbox]').forEach((el) => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lightbox.hidden) close();
    });
  },

  openImagePreview(src) {
    const { lightbox, lightboxImg } = this.els;
    if (!lightbox || !lightboxImg) return;
    lightboxImg.src = src;
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('imageLightboxClose')?.focus();
  },

  closeImagePreview() {
    const { lightbox, lightboxImg } = this.els;
    if (!lightbox || !lightboxImg) return;
    lightbox.hidden = true;
    lightboxImg.src = '';
    document.body.style.overflow = '';
  },

  parseImageDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const match = dataUrl.match(/^data:image\/([\w+.-]+);base64,(.+)$/);
    if (!match) return null;
    let extension = match[1].toLowerCase();
    if (extension === 'jpg') extension = 'jpeg';
    if (!['png', 'jpeg', 'gif'].includes(extension)) extension = 'png';
    return { extension, base64: match[2] };
  },

  formatExportCellValue(col, row, rowIndex) {
    if (col.kind === 'image') return '';
    const raw = col.get ? col.get(row, rowIndex) : row[col.key];
    if (raw === null || raw === undefined) return '';
    if (col.type === 'number') {
      if (raw === '') return '';
      const num = Number(raw);
      return Number.isFinite(num) ? num : '';
    }
    return raw;
  },

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  async exportToExcel() {
    if (typeof ExcelJS === 'undefined') {
      alert('Excel出力ライブラリの読み込みに失敗しました。ページを再読み込みしてください。');
      return;
    }
    if (!this.rows.length) {
      alert('エクスポートするデータがありません。');
      return;
    }

    const columns = this.EXPORT_COLUMNS;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('在庫・売上');
    const imagePx = 72;

    worksheet.addRow(columns.map((c) => c.header));
    worksheet.getRow(1).font = { bold: true };
    columns.forEach((col, i) => {
      worksheet.getColumn(i + 1).width = col.width ?? Math.max(12, Math.min(36, col.header.length + 6));
    });

    this.rows.forEach((row, rowIndex) => {
      const excelRow = worksheet.addRow(columns.map((col) => this.formatExportCellValue(col, row, rowIndex)));
      const images = Array.isArray(row.images) ? row.images : [];
      if (images.length) excelRow.height = imagePx * 0.75 + 8;

      images.forEach((src, imageIndex) => {
        const colIndex = columns.findIndex((c) => c.kind === 'image' && c.imageIndex === imageIndex);
        const parsed = this.parseImageDataUrl(src);
        if (colIndex < 0 || !parsed) return;

        const imageId = workbook.addImage({ base64: parsed.base64, extension: parsed.extension });
        worksheet.addImage(imageId, {
          tl: { col: colIndex, row: rowIndex + 1 },
          ext: { width: imagePx, height: imagePx },
        });
      });
    });

    const date = new Date();
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    try {
      const buffer = await workbook.xlsx.writeBuffer();
      this.downloadBlob(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `在庫売上管理_${stamp}.xlsx`
      );
    } catch (err) {
      console.error('Excel出力に失敗しました:', err);
      alert('Excel出力に失敗しました。画像データが大きすぎる可能性があります。');
    }
  },

  renderTable({ preserveScroll = true } = {}) {
    const { tbody, wrapper } = this.els;
    if (!tbody) return;

    const saved = preserveScroll && wrapper
      ? { top: wrapper.scrollTop, left: wrapper.scrollLeft }
      : null;

    tbody.replaceChildren();
    if (!this.rows.length) this.rows.push(this.createEmptyRow());

    this.rows.forEach((row, index) => {
      tbody.appendChild(this.createRowElement(row, index));
    });

    this.updateSummary();
    this.applyColumnWidths();

    requestAnimationFrame(() => {
      this.updateStickyPositions();
      if (!saved) return;
      wrapper.scrollTop = saved.top;
      wrapper.scrollLeft = saved.left;
      requestAnimationFrame(() => {
        wrapper.scrollTop = saved.top;
        wrapper.scrollLeft = saved.left;
        this.updateStickyPositions();
      });
    });
  },

  addRow() {
    const row = this.createEmptyRow();
    const index = this.rows.length;
    this.rows.push(row);
    this.pushAddHistory(row, index);
    this.saveToStorage();
    this.renderTable({ preserveScroll: false });
    this.$('#tableBody tr:last-child')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
};

document.addEventListener('DOMContentLoaded', () => InventoryApp.init());