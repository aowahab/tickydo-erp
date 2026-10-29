import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const outputDirectory = new URL('../dist/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
await copyFile(
    fileURLToPath(new URL('../Tickydo_ERP_Accounting___Financial_Management.html', import.meta.url)),
    fileURLToPath(new URL('../dist/index.html', import.meta.url))
);
