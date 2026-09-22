var SPREADSHEET_NAME = 'LaporKasir Data';
var REPORT_SHEET_NAME = 'Laporan';
var EXPENSE_SHEET_NAME = 'Pengeluaran';
var SPREADSHEET_ID_PROPERTY = 'LAPORKASIR_SPREADSHEET_ID';
var DRIVE_FOLDER_ID_PROPERTY = 'LAPORKASIR_DRIVE_FOLDER_ID';
var ACCESS_TOKEN_PROPERTY = 'LAPORKASIR_ACCESS_TOKEN';
var ALLOWED_ORIGINS_PROPERTY = 'LAPORKASIR_ALLOWED_ORIGINS';
var MAX_PAYLOAD_LENGTH = 12 * 1024 * 1024;
var MAX_IMAGE_LENGTH = 8 * 1024 * 1024;
var DENOMINATIONS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500];

var REPORT_HEADERS = [
  'submitted_at_server',
  'submitted_at_client',
  'report_date',
  'submission_id',
  'revision',
  'fingerprint',
  'request_id',
  'spreadsheet_url',
  'screenshot_url',
  'screenshot_file_id',
  'screenshot_filename',
  'status',
  'kas_awal',
  'kas_akhir',
  'selisih_kas',
  'total_pengeluaran',
  'setor_tunai',
  'pendapatan_cash',
  'pendapatan_qris',
  'pendapatan_lain_lain',
  'total_pendapatan',
  'total_qasir',
  'selisih_akhir',
  'notes',
  'report_text'
].concat(
  DENOMINATIONS.map(function(value) { return 'awal_' + value; }),
  DENOMINATIONS.map(function(value) { return 'akhir_' + value; })
);

var EXPENSE_HEADERS = [
  'submitted_at_server',
  'report_date',
  'submission_id',
  'revision',
  'expense_index',
  'name',
  'qty',
  'unit',
  'amount'
];

function doGet() {
  return HtmlService
    .createHtmlOutput('LaporKasir Apps Script endpoint is active.');
}

// Trailing underscore prevents access through google.script.run from HTML responses.
function authorizeLaporKasir_() {
  var folder = DriveApp.getFolderById(getDriveFolderId_());
  var spreadsheet = getOrCreateSpreadsheet_();

  return {
    folderName: folder.getName(),
    spreadsheetUrl: spreadsheet.getUrl()
  };
}

function doPost(e) {
  var requestId = '';
  var targetOrigin = '';
  var response;

  try {
    var payloadText = getPayloadText_(e);
    if (payloadText.length > MAX_PAYLOAD_LENGTH) throw requestError_('Laporan terlalu besar.');
    var payload = JSON.parse(payloadText);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw requestError_('Format laporan tidak valid.');
    requestId = typeof payload.requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.requestId) ? payload.requestId : '';
    targetOrigin = getAllowedOrigin_(payload.clientOrigin);
    response = saveReport_(payload);
  } catch (err) {
    response = {
      ok: false,
      status: 'error',
      code: err && err.publicCode ? err.publicCode : 'SAVE_FAILED',
      message: err && err.publicCode ? err.message : 'Laporan gagal disimpan. Periksa konfigurasi atau hubungi pengelola.'
    };
  }

  return renderResponse_(requestId, response, targetOrigin);
}

function saveReport_(payload) {
  authorizeSubmission_(payload);
  validatePayload_(payload);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return saveReportLocked_(payload);
  } finally {
    lock.releaseLock();
  }
}

function requestError_(message, code) {
  var error = new Error(message);
  error.publicCode = code || 'INVALID_REQUEST';
  return error;
}

function getDriveFolderId_() {
  var id = PropertiesService.getScriptProperties().getProperty(DRIVE_FOLDER_ID_PROPERTY);
  if (!id) throw new Error('Drive folder is not configured.');
  return id;
}

function getAllowedOrigin_(origin) {
  var configured = PropertiesService.getScriptProperties().getProperty(ALLOWED_ORIGINS_PROPERTY) || '';
  var origins = configured.split(',').map(function(value) { return value.trim(); }).filter(Boolean);
  var isWebOrigin = typeof origin === 'string' &&
    /^(https:\/\/[a-z0-9.-]+(:[0-9]+)?|http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?)$/i.test(origin);
  if (!isWebOrigin || origins.indexOf(origin) === -1) throw requestError_('Alamat aplikasi belum diizinkan.');
  return origin;
}

function authorizeSubmission_(payload) {
  var expected = PropertiesService.getScriptProperties().getProperty(ACCESS_TOKEN_PROPERTY);
  if (!expected || expected.length < 32 || expected.length > 256) throw new Error('Access token is not configured.');
  if (!payload || typeof payload.authToken !== 'string' || payload.authToken.length > 256) {
    throw requestError_('Kode akses tidak valid. Hubungi pengelola.', 'UNAUTHORIZED');
  }
  // Compare fixed-length digests; the token is never persisted with the report.
  var actualHash = sha256_(payload.authToken);
  var expectedHash = sha256_(expected);
  var difference = 0;
  for (var i = 0; i < expectedHash.length; i++) {
    difference |= actualHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  if (difference !== 0) throw requestError_('Kode akses tidak valid. Hubungi pengelola.', 'UNAUTHORIZED');
  // Origin restrictions are defense in depth, not a substitute for the token.
  getAllowedOrigin_(payload.clientOrigin);
}

function validatePayload_(payload) {
  function text(value, maximum, required) {
    if (!required && (value === undefined || value === null)) return;
    if (typeof value !== 'string' || value.length > maximum || (required && !value)) {
      throw requestError_('Teks laporan tidak valid atau terlalu panjang.');
    }
  }
  function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw requestError_('Format laporan tidak valid.');
  }
  function numeric(value, optional, nonnegative, integer) {
    if (optional && (value === undefined || value === null || value === '')) return;
    if (typeof value !== 'number' || !isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER ||
        (nonnegative && value < 0) || (integer && Math.floor(value) !== value)) {
      throw requestError_('Nilai angka laporan tidak valid.');
    }
  }

  text(payload.requestId, 128, true);
  if (!/^[A-Za-z0-9_-]+$/.test(payload.requestId)) throw requestError_('ID permintaan tidak valid.');
  text(payload.reportDate, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.reportDate)) throw requestError_('Tanggal laporan tidak valid.');
  var date = new Date(payload.reportDate + 'T00:00:00Z');
  if (!isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== payload.reportDate) throw requestError_('Tanggal laporan tidak valid.');
  text(payload.submittedClientAt, 40, false);
  text(payload.notes, 20000, false);
  text(payload.reportText, 45000, false);
  text(payload.discrepancyStatus, 80, false);
  object(payload.calculations);
  ['startTotal', 'endTotal', 'expensesTotal', 'netCashFlow', 'cashIncome', 'qris', 'lainLain',
    'setorTunai', 'totalIncome', 'qasir', 'discrepancy'].forEach(function(key) {
    numeric(payload.calculations[key], false, false, false);
  });
  object(payload.denominations);
  ['start', 'end'].forEach(function(side) {
    object(payload.denominations[side]);
    DENOMINATIONS.forEach(function(value) { numeric(payload.denominations[side][value], true, true, true); });
  });
  if (!Array.isArray(payload.expenses) || payload.expenses.length > 500) throw requestError_('Maksimal 500 pengeluaran per laporan.');
  payload.expenses.forEach(function(expense) {
    object(expense);
    text(expense.name, 1000, true);
    text(expense.unit, 100, false);
    numeric(expense.index, true, true, true);
    numeric(expense.qty, true, false, false);
    numeric(expense.amount, false, true, false);
  });
  if (payload.image !== undefined && payload.image !== null) {
    object(payload.image);
    text(payload.image.base64, MAX_IMAGE_LENGTH, false);
    text(payload.image.filename, 200, false);
    if (payload.image.filename && !/^[A-Za-z0-9_. ()-]+\.png$/i.test(payload.image.filename)) throw requestError_('Nama gambar tidak valid.');
    if (payload.image.base64) {
      if (payload.image.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.image.base64)) throw requestError_('Data gambar tidak valid.');
      var bytes = Utilities.base64Decode(payload.image.base64);
      var signature = [137, 80, 78, 71, 13, 10, 26, 10];
      if (bytes.length < signature.length || !signature.every(function(value, index) { return (bytes[index] & 255) === value; })) {
        throw requestError_('Gambar harus berformat PNG.');
      }
    }
  }
}

function safeCellValue_(value) {
  // An apostrophe makes formula-like strings literal in Sheets; keep numbers numeric.
  return typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@'\-]/.test(value) ? "'" + value : value;
}

function saveReportLocked_(payload) {
  var spreadsheet = getOrCreateSpreadsheet_();
  var reportSheet = ensureSheet_(spreadsheet, REPORT_SHEET_NAME, REPORT_HEADERS);
  var expenseSheet = ensureSheet_(spreadsheet, EXPENSE_SHEET_NAME, EXPENSE_HEADERS);
  var fingerprint = buildFingerprint_(payload);
  var duplicate = findDuplicate_(reportSheet, fingerprint);

  if (duplicate) {
    refreshDuplicate_(reportSheet, payload, spreadsheet, fingerprint, duplicate);
    return {
      ok: true,
      status: 'duplicate',
      existingSubmissionId: duplicate.submissionId,
      message: 'Laporan sudah terekam di database.'
    };
  }

  var submittedAtServer = new Date();
  var revision = getNextRevision_(reportSheet, payload.reportDate);
  var submissionId = Utilities.getUuid();
  var screenshot = saveScreenshot_(payload.image);
  var reportRow = buildReportRow_(payload, {
    submittedAtServer: submittedAtServer,
    spreadsheet: spreadsheet,
    submissionId: submissionId,
    revision: revision,
    fingerprint: fingerprint,
    screenshot: screenshot
  });
  var expenseRows = buildExpenseRows_(payload, submittedAtServer, submissionId, revision);

  reportSheet.appendRow(reportRow);
  if (expenseRows.length > 0) {
    expenseSheet.getRange(expenseSheet.getLastRow() + 1, 1, expenseRows.length, EXPENSE_HEADERS.length).setValues(expenseRows);
  }

  return {
    ok: true,
    status: 'saved',
    submissionId: submissionId,
    revision: revision,
    spreadsheetUrl: spreadsheet.getUrl(),
    screenshotUrl: screenshot.url
  };
}

function refreshDuplicate_(sheet, payload, spreadsheet, fingerprint, duplicate) {
  var existing = getExistingScreenshot_(sheet, duplicate.row);
  var screenshot = existing.id || !payload.image || !payload.image.base64
    ? existing
    : saveScreenshot_(payload.image);
  var reportRow = buildReportRow_(payload, {
    submittedAtServer: new Date(),
    spreadsheet: spreadsheet,
    submissionId: duplicate.submissionId || Utilities.getUuid(),
    revision: duplicate.revision || 1,
    fingerprint: fingerprint,
    screenshot: screenshot
  });

  sheet.getRange(duplicate.row, 1, 1, REPORT_HEADERS.length).setValues([reportRow]);
}

function getExistingScreenshot_(sheet, rowNumber) {
  var headers = sheet.getRange(1, 1, 1, REPORT_HEADERS.length).getValues()[0];
  var values = sheet.getRange(rowNumber, 1, 1, REPORT_HEADERS.length).getValues()[0];

  function valueFor(header) {
    var index = headers.indexOf(header);
    return index >= 0 ? String(values[index] || '') : '';
  }

  return {
    id: valueFor('screenshot_file_id'),
    url: valueFor('screenshot_url'),
    filename: valueFor('screenshot_filename')
  };
}

function getOrCreateSpreadsheet_() {
  var properties = PropertiesService.getScriptProperties();
  var storedId = properties.getProperty(SPREADSHEET_ID_PROPERTY);

  if (storedId) {
    // A permissions/configuration error must not silently redirect reports to a new file.
    return SpreadsheetApp.openById(storedId);
  }

  var spreadsheet = SpreadsheetApp.create(SPREADSHEET_NAME);
  spreadsheet.getSheets()[0].setName(REPORT_SHEET_NAME);
  properties.setProperty(SPREADSHEET_ID_PROPERTY, spreadsheet.getId());
  return spreadsheet;
}

function ensureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  else sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function saveScreenshot_(image) {
  if (!image || !image.base64) return { id: '', url: '', filename: '' };

  var folder = DriveApp.getFolderById(getDriveFolderId_());
  var filename = image.filename || 'Laporan_Harian.png';
  var bytes = Utilities.base64Decode(image.base64);
  var blob = Utilities.newBlob(bytes, 'image/png', filename);
  var file = folder.createFile(blob);

  return {
    id: file.getId(),
    url: file.getUrl(),
    filename: file.getName()
  };
}

function buildReportRow_(payload, context) {
  var row = [
    context.submittedAtServer,
    payload.submittedClientAt || '',
    payload.reportDate || '',
    context.submissionId,
    context.revision,
    context.fingerprint,
    payload.requestId || '',
    context.spreadsheet.getUrl(),
    context.screenshot.url || '',
    context.screenshot.id || '',
    context.screenshot.filename || '',
    payload.discrepancyStatus || '',
    calculationValue_(payload, 'startTotal'),
    calculationValue_(payload, 'endTotal'),
    calculationValue_(payload, 'netCashFlow'),
    calculationValue_(payload, 'expensesTotal'),
    calculationValue_(payload, 'setorTunai'),
    calculationValue_(payload, 'cashIncome'),
    calculationValue_(payload, 'qris'),
    calculationValue_(payload, 'lainLain'),
    calculationValue_(payload, 'totalIncome'),
    calculationValue_(payload, 'qasir'),
    calculationValue_(payload, 'discrepancy'),
    payload.notes || '',
    payload.reportText || ''
  ];

  DENOMINATIONS.forEach(function(value) {
    row.push(denominationValue_(payload, 'start', value));
  });
  DENOMINATIONS.forEach(function(value) {
    row.push(denominationValue_(payload, 'end', value));
  });

  return row.map(safeCellValue_);
}

function buildExpenseRows_(payload, submittedAtServer, submissionId, revision) {
  var expenses = Array.isArray(payload.expenses) ? payload.expenses : [];
  return expenses.map(function(expense, index) {
    return [
      submittedAtServer,
      payload.reportDate || '',
      submissionId,
      revision,
      expense.index || index + 1,
      expense.name || '',
      expense.qty === undefined || expense.qty === null ? '' : expense.qty,
      expense.unit || '',
      numberValue_(expense.amount)
    ].map(safeCellValue_);
  });
}

function buildFingerprint_(payload) {
  var normalized = {
    reportDate: String(payload.reportDate || ''),
    notes: String(payload.notes || ''),
    calculations: {},
    denominations: { start: {}, end: {} },
    expenses: []
  };

  [
    'startTotal',
    'endTotal',
    'expensesTotal',
    'netCashFlow',
    'cashIncome',
    'qris',
    'lainLain',
    'setorTunai',
    'totalIncome',
    'qasir',
    'discrepancy'
  ].forEach(function(key) {
    normalized.calculations[key] = calculationValue_(payload, key);
  });

  DENOMINATIONS.forEach(function(value) {
    normalized.denominations.start[value] = denominationValue_(payload, 'start', value);
    normalized.denominations.end[value] = denominationValue_(payload, 'end', value);
  });

  (Array.isArray(payload.expenses) ? payload.expenses : []).forEach(function(expense) {
    normalized.expenses.push({
      name: String(expense.name || '').trim(),
      qty: normalizeQty_(expense.qty),
      unit: String(expense.unit || '').trim(),
      amount: numberValue_(expense.amount)
    });
  });

  return sha256_(JSON.stringify(normalized));
}

function findDuplicate_(sheet, fingerprint) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;

  var headers = values[0];
  var fingerprintIndex = headers.indexOf('fingerprint');
  var submissionIndex = headers.indexOf('submission_id');
  var revisionIndex = headers.indexOf('revision');
  if (fingerprintIndex < 0) return null;

  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][fingerprintIndex]) === fingerprint) {
      return {
        row: i + 1,
        submissionId: submissionIndex >= 0 ? String(values[i][submissionIndex]) : '',
        revision: revisionIndex >= 0 ? numberValue_(values[i][revisionIndex]) : 0
      };
    }
  }
  return null;
}

function getNextRevision_(sheet, reportDate) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return 1;

  var headers = values[0];
  var dateIndex = headers.indexOf('report_date');
  var revisionIndex = headers.indexOf('revision');
  var maxRevision = 0;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][dateIndex]) === String(reportDate)) {
      maxRevision = Math.max(maxRevision, numberValue_(values[i][revisionIndex]));
    }
  }

  return maxRevision + 1;
}

function getPayloadText_(e) {
  if (e && e.parameter && e.parameter.payload) return e.parameter.payload;
  if (e && e.postData && e.postData.contents) return e.postData.contents;
  throw new Error('Payload kosong.');
}

function renderResponse_(requestId, response, targetOrigin) {
  var envelope = {
    source: 'laporkasir-apps-script',
    requestId: requestId || '',
    response: response
  };
  if (!targetOrigin) {
    return ContentService.createTextOutput(JSON.stringify(envelope)).setMimeType(ContentService.MimeType.JSON);
  }
  var json = JSON.stringify(envelope).replace(/</g, '\\u003c');
  var originJson = JSON.stringify(targetOrigin).replace(/</g, '\\u003c');
  var html = '<!doctype html><html><body><script>window.top.postMessage(' + json + ', ' + originJson + ');</script></body></html>';

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function calculationValue_(payload, key) {
  return numberValue_(payload && payload.calculations ? payload.calculations[key] : 0);
}

function denominationValue_(payload, side, value) {
  var denominations = payload && payload.denominations && payload.denominations[side] ? payload.denominations[side] : {};
  return numberValue_(denominations[value]);
}

function normalizeQty_(value) {
  if (value === '' || value === null || value === undefined) return '';
  var numeric = Number(value);
  return isFinite(numeric) ? numeric : String(value).trim();
}

function numberValue_(value) {
  var numeric = Number(value);
  return isFinite(numeric) ? numeric : 0;
}

function sha256_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map(function(byte) {
    var value = byte < 0 ? byte + 256 : byte;
    var hex = value.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}
