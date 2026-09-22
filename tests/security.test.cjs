const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const browserSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const token = 'synthetic-test-token-'.repeat(3);
const origin = 'https://cashier.example.com';

function backend() {
    const properties = new Map([
        ['LAPORKASIR_ACCESS_TOKEN', token],
        ['LAPORKASIR_ALLOWED_ORIGINS', origin + ',http://127.0.0.1:8000'],
        ['LAPORKASIR_DRIVE_FOLDER_ID', 'synthetic-server-folder']
    ]);
    const effects = [];
    function output(content) {
        return { content, setMimeType() { return this; }, setXFrameOptionsMode() { return this; } };
    }
    const context = vm.createContext({
        PropertiesService: { getScriptProperties: () => ({
            getProperty: key => properties.get(key),
            setProperty: (key, value) => properties.set(key, value)
        }) },
        Utilities: {
            DigestAlgorithm: { SHA_256: 'sha256' },
            Charset: { UTF_8: 'utf8' },
            computeDigest: (algorithm, value) => [...crypto.createHash(algorithm).update(value).digest()],
            base64Decode: value => [...Buffer.from(value, 'base64')],
            newBlob: (bytes, mime, filename) => ({ bytes, mime, filename }),
            getUuid: () => 'synthetic-submission-id'
        },
        LockService: { getScriptLock: () => ({
            waitLock: () => effects.push('lock'),
            releaseLock: () => effects.push('unlock')
        }) },
        HtmlService: { createHtmlOutput: output, XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
        ContentService: { createTextOutput: output, MimeType: { JSON: 'json' } },
        DriveApp: { getFolderById: id => ({
            createFile(blob) {
                effects.push({ folder: id, blob });
                return { getId: () => 'image-id', getUrl: () => 'https://example.com/image', getName: () => blob.filename };
            }
        }) }
    });
    vm.runInContext(serverSource, context);
    return { context, properties, effects };
}

function payload() {
    return {
        requestId: 'synthetic-request-id', authToken: token, clientOrigin: origin,
        reportDate: '2026-09-22', submittedClientAt: '2026-09-22T09:00:00.000Z',
        notes: 'Catatan biasa', reportText: 'Laporan pengujian', discrepancyStatus: 'SUDAH SESUAI',
        calculations: {
            startTotal: 100000, endTotal: 150000, expensesTotal: 10000, netCashFlow: 50000,
            cashIncome: 80000, qris: 40000, lainLain: 5000, setorTunai: 20000,
            totalIncome: 120000, qasir: 115000, discrepancy: 0
        },
        denominations: { start: { 100000: 1 }, end: { 100000: 1, 50000: 1 } },
        expenses: [{ index: 1, name: 'Beras', qty: 0.5, unit: 'kg', amount: 10000 }],
        image: { filename: 'Laporan_Harian_2026-09-22.png', base64: '' }
    };
}

function frontend() {
    const element = () => ({
        classList: { add() {}, remove() {}, toggle() {} }, style: {},
        appendChild() {}, querySelector: () => element(), addEventListener() {}
    });
    const elements = new Map();
    const context = vm.createContext({
        window: { LAPORKASIR_CONFIG: {}, crypto }, crypto,
        localStorage: { getItem: () => null, setItem() {} },
        document: {
            getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
            createElement: element
        },
        console, setTimeout, clearTimeout, Intl
    });
    vm.runInContext(browserSource, context);
    return context;
}

test('browser and Apps Script sources parse', () => {
    new vm.Script(serverSource);
    new vm.Script(browserSource);
});

test('only HTTP entrypoints are callable through Apps Script browser RPC', () => {
    const publicFunctions = [...serverSource.matchAll(/^function (\w+)\(/gm)]
        .map(match => match[1]).filter(name => !name.endsWith('_'));
    assert.deepEqual(publicFunctions, ['doGet', 'doPost']);
});

test('valid report is accepted; fractional expense quantities and negative discrepancies remain valid', () => {
    const { context } = backend();
    const data = payload();
    data.calculations.discrepancy = -500;
    assert.doesNotThrow(() => context.authorizeSubmission_(data));
    assert.doesNotThrow(() => context.validatePayload_(data));
});

test('missing, wrong and oversized access codes fail before locking or writing', () => {
    for (const value of [undefined, '', 'wrong', 'x'.repeat(257)]) {
        const { context, effects } = backend();
        assert.throws(() => context.saveReport_({ ...payload(), authToken: value }), /Kode akses/);
        assert.deepEqual(effects, []);
    }
    const { context, properties, effects } = backend();
    properties.delete('LAPORKASIR_ACCESS_TOKEN');
    assert.throws(() => context.saveReport_(payload()), /not configured/);
    assert.deepEqual(effects, []);
});

test('only exact configured web origins are allowed', () => {
    const { context } = backend();
    assert.equal(context.getAllowedOrigin_(origin), origin);
    assert.equal(context.getAllowedOrigin_('http://127.0.0.1:8000'), 'http://127.0.0.1:8000');
    for (const value of ['null', '*', origin + '.evil.example', origin + '/path', 'http://example.com', undefined]) {
        assert.throws(() => context.getAllowedOrigin_(value));
    }
});

test('malformed, oversized and unexpected inputs fail before side effects', () => {
    const mutations = [
        p => { p.reportDate = '2026-02-30'; },
        p => { p.requestId = '</script>'; },
        p => { p.notes = '=x'.repeat(20001); },
        p => { p.expenses = Array(501).fill(p.expenses[0]); },
        p => { p.expenses[0].qty = '=IMPORTXML("https://example.com","//x")'; },
        p => { p.expenses[0].name = { formula: '=1+1' }; },
        p => { p.calculations.totalIncome = Infinity; },
        p => { p.denominations.start[100000] = -1; },
        p => { p.image.base64 = 'x'.repeat(8 * 1024 * 1024 + 1); },
        p => { p.image.base64 = Buffer.from('<html>not a PNG</html>').toString('base64'); },
        p => { p.image.filename = '../report.png'; }
    ];
    for (const mutate of mutations) {
        const { context, effects } = backend();
        const data = payload();
        mutate(data);
        assert.throws(() => context.saveReport_(data));
        assert.deepEqual(effects, []);
    }
});

test('spreadsheet text is literal while numbers and ordinary text retain their types', () => {
    const { context } = backend();
    for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=1+1', '\n=1+1', "'=1+1"]) {
        assert.equal(context.safeCellValue_(value), "'" + value);
    }
    assert.equal(context.safeCellValue_(-500), -500);
    assert.equal(context.safeCellValue_('Beras & minyak'), 'Beras & minyak');
    const data = payload();
    data.notes = '=IMPORTXML("https://example.com","//x")';
    data.reportText = '+SUM(A1)';
    data.expenses[0].name = '=1+1';
    data.expenses[0].unit = '@SUM(A1)';
    const row = context.buildReportRow_(data, {
        submittedAtServer: new Date(), submissionId: 'id', revision: 1, fingerprint: 'hash',
        spreadsheet: { getUrl: () => 'https://example.com/sheet' },
        screenshot: { filename: '=image.png' }
    });
    for (const header of ['notes', 'report_text', 'screenshot_filename']) {
        assert.ok(row[context.REPORT_HEADERS.indexOf(header)].startsWith("'"));
    }
    const expense = context.buildExpenseRows_(data, new Date(), 'id', 1)[0];
    assert.equal(expense[5], "'=1+1");
    assert.equal(expense[7], "'@SUM(A1)");
    assert.equal(expense[6], 0.5);
    assert.equal(expense[8], 10000);
});

test('upload destination comes exclusively from server properties', () => {
    const { context, effects } = backend();
    context.saveScreenshot_({
        base64: 'iVBORw0KGgo=', filename: 'report.png', folderId: 'attacker-controlled-folder'
    });
    assert.equal(effects[0].folder, 'synthetic-server-folder');
});

test('response cannot inject HTML, uses exact target origin and never exposes raw server errors', () => {
    const { context } = backend();
    const rendered = context.renderResponse_('</script><img src=x>', { ok: true }, origin).content;
    assert.ok(!rendered.includes('</script><img'));
    assert.ok(rendered.includes(JSON.stringify(origin)));
    assert.ok(!rendered.includes(', "*"'));
    assert.doesNotThrow(() => JSON.parse(context.doPost({}).content));
    assert.equal(JSON.parse(context.doPost({ parameter: { payload: '{bad-json' } }).content).response.code, 'SAVE_FAILED');
    context.saveReport_ = () => { throw new Error('PRIVATE_FOLDER_ID: confidential'); };
    const result = context.doPost({ parameter: { payload: JSON.stringify(payload()) } }).content;
    assert.ok(!result.includes('PRIVATE_FOLDER_ID'));
    assert.ok(!result.includes(token));
});

test('existing spreadsheet errors do not cause silent replacement', () => {
    const { context, properties } = backend();
    properties.set('LAPORKASIR_SPREADSHEET_ID', 'existing-sheet');
    context.SpreadsheetApp = { openById() { throw new Error('Permission denied'); } };
    assert.throws(() => context.getOrCreateSpreadsheet_(), /Permission denied/);
    assert.equal(properties.get('LAPORKASIR_SPREADSHEET_ID'), 'existing-sheet');
});

test('duplicate detection and revisions retain their existing behavior', () => {
    const { context } = backend();
    const rows = [
        ['fingerprint', 'submission_id', 'revision', 'report_date'],
        ['hash-a', 'first', 1, '2026-09-22'],
        ['hash-b', 'second', 2, '2026-09-22']
    ];
    const sheet = { getDataRange: () => ({ getValues: () => rows }) };
    assert.equal(context.findDuplicate_(sheet, 'hash-a').submissionId, 'first');
    assert.equal(context.findDuplicate_(sheet, 'missing'), null);
    assert.equal(context.getNextRevision_(sheet, '2026-09-22'), 3);
    assert.equal(context.getNextRevision_(sheet, '2026-09-23'), 1);
    const first = payload();
    const retry = { ...first, requestId: 'retry', authToken: 'changed', image: { base64: 'changed' } };
    assert.equal(context.buildFingerprint_(first), context.buildFingerprint_(retry));
});

test('authenticated save, duplicate screenshot recovery, and revised reports keep sheet relationships', () => {
    const { context, properties, effects } = backend();
    const sheets = new Map();
    function makeSheet() {
        const rows = [];
        return {
            rows,
            getLastRow: () => rows.length,
            appendRow: row => rows.push(Array.from(row)),
            setFrozenRows() {},
            getDataRange: () => ({ getValues: () => rows }),
            getRange: (start, column, height, width) => ({
                getValues: () => rows.slice(start - 1, start - 1 + height)
                    .map(row => row.slice(column - 1, column - 1 + width)),
                setValues(values) {
                    values.forEach((row, index) => { rows[start - 1 + index] = Array.from(row); });
                }
            })
        };
    }
    const spreadsheet = {
        getSheetByName: name => sheets.get(name),
        insertSheet(name) { const sheet = makeSheet(); sheets.set(name, sheet); return sheet; },
        getUrl: () => 'https://example.com/sheet'
    };
    properties.set('LAPORKASIR_SPREADSHEET_ID', 'existing-sheet');
    context.SpreadsheetApp = { openById: () => spreadsheet };
    let sequence = 0;
    context.Utilities.getUuid = () => 'submission-' + ++sequence;
    const first = payload();
    const saved = context.saveReport_(first);
    assert.equal(saved.status, 'saved');
    assert.equal(saved.revision, 1);
    assert.equal(sheets.get('Laporan').rows.length, 2);
    assert.equal(sheets.get('Pengeluaran').rows.length, 2);
    const retry = payload();
    retry.image.base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    const duplicate = context.saveReport_(retry);
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(duplicate.existingSubmissionId, saved.submissionId);
    assert.equal(sheets.get('Laporan').rows.length, 2);
    assert.equal(sheets.get('Pengeluaran').rows.length, 2);
    assert.equal(effects.filter(effect => effect.folder).length, 1);
    const updated = payload();
    updated.notes = 'Revisi catatan';
    const revised = context.saveReport_(updated);
    assert.equal(revised.status, 'saved');
    assert.equal(revised.revision, 2);
    assert.notEqual(revised.submissionId, saved.submissionId);
    assert.equal(sheets.get('Pengeluaran').rows[2][2], revised.submissionId);
    assert.ok(!JSON.stringify([...sheets.values()].map(sheet => sheet.rows)).includes(token));
    assert.equal(effects.filter(effect => effect === 'unlock').length, 3);
});

test('browser keeps calculation behavior and escapes text and attribute payloads', () => {
    const context = frontend();
    vm.runInContext(`
        shiftData.start[100000] = 1;
        shiftData.end[100000] = 1;
        shiftData.end[50000] = 1;
        shiftData.expenses = [{ amount: 10000 }];
        shiftData.setorTunai = 20000;
        shiftData.qris = 40000;
        shiftData.lainLain = 5000;
        shiftData.qasir = 115000;
    `, context);
    const result = context.getReportCalculations();
    assert.equal(result.cashIncome, 80000);
    assert.equal(result.totalIncome, 120000);
    assert.equal(result.discrepancy, 0);
    assert.equal(context.escapeHtml('</textarea><img src=x onerror="alert(1)">'),
        '&lt;/textarea&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(context.escapeHtml("'&"), '&#39;&amp;');
});

test('browser accepts only Google responses belonging to the submitted iframe', () => {
    const context = frontend();
    const frame = {};
    const nested = { parent: frame };
    assert.equal(context.isAppsScriptResponse({ origin: 'https://script.googleusercontent.com', source: nested }, { contentWindow: frame }), true);
    assert.equal(context.isAppsScriptResponse({ origin: 'https://abc-script.googleusercontent.com', source: nested }, { contentWindow: frame }), true);
    for (const responseOrigin of ['https://evil.example', 'https://script.googleusercontent.com.evil.example', 'null']) {
        assert.equal(context.isAppsScriptResponse({ origin: responseOrigin, source: nested }, { contentWindow: frame }), false);
    }
    assert.equal(context.isAppsScriptResponse({ origin: 'https://script.googleusercontent.com', source: {} }, { contentWindow: frame }), false);
});
