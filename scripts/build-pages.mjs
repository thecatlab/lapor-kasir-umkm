import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildPages(outputDirectory, googleScriptUrl) {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(googleScriptUrl || '')) {
        throw new Error('Set LAPORKASIR_GOOGLE_SCRIPT_URL to the existing Apps Script /exec URL before deploying.');
    }
    const root = fileURLToPath(new URL('../', import.meta.url));
    const output = resolve(outputDirectory);
    if (output === root) throw new Error('The deployment output must not be the repository root.');
    await mkdir(output, { recursive: true });
    if ((await readdir(output)).length) throw new Error('Use an empty deployment output directory.');
    await mkdir(join(output, 'assets'));
    await copyFile(join(root, 'index.html'), join(output, 'index.html'));
    await copyFile(join(root, 'assets/styles.css'), join(output, 'assets/styles.css'));
    await writeFile(join(output, 'config.js'),
        '// Public deployment configuration; never add credentials here.\n' +
        'window.LAPORKASIR_CONFIG = ' + JSON.stringify({ googleScriptUrl }) + ';\n');
    await writeFile(join(output, '.nojekyll'), '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await buildPages('.pages', process.env.LAPORKASIR_GOOGLE_SCRIPT_URL);
    console.log('Prepared browser assets and runtime configuration for GitHub Pages.');
}
