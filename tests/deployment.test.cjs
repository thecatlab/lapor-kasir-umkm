const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const vm = require('node:vm');

test('Pages artifact contains runtime configuration and only intended public assets', async () => {
    const { buildPages } = await import('../scripts/build-pages.mjs');
    const output = await mkdtemp(join(tmpdir(), 'laporkasir-pages-test-'));
    try {
        const url = 'https://script.google.com/macros/s/synthetic-test-deployment/exec';
        await buildPages(output, url);
        assert.deepEqual((await readdir(output)).sort(), ['.nojekyll', 'assets', 'config.js', 'index.html']);
        assert.deepEqual(await readdir(join(output, 'assets')), ['styles.css']);
        const context = vm.createContext({ window: {} });
        vm.runInContext(await readFile(join(output, 'config.js'), 'utf8'), context);
        assert.equal(context.window.LAPORKASIR_CONFIG.googleScriptUrl, url);
        assert.deepEqual(Object.keys(context.window.LAPORKASIR_CONFIG), ['googleScriptUrl']);
        await assert.rejects(buildPages(output, url), /empty deployment output/);
    } finally {
        await rm(output, { recursive: true, force: true });
    }
});

test('missing or unsafe deployment URL fails before creating an artifact', async () => {
    const { buildPages } = await import('../scripts/build-pages.mjs');
    for (const value of ['', undefined, 'https://example.com', 'javascript:alert(1)',
        'https://script.google.com/macros/s/test/exec?token=secret']) {
        await assert.rejects(buildPages('unused-test-output', value), /LAPORKASIR_GOOGLE_SCRIPT_URL/);
    }
});
