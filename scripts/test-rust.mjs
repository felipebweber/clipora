import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encontrarExecutavel } from './comum.mjs';

// Testes unitários não empacotam sidecars; preserve as demais opções do ambiente.
const config = JSON.parse(process.env.TAURI_CONFIG || '{}');
config.bundle = { ...config.bundle, externalBin: [] };
const cargo = encontrarExecutavel('cargo', [join(homedir(), '.cargo', 'bin')]);
if (!cargo) {
  console.error('cargo não encontrado (nem no PATH nem em ~/.cargo/bin).');
  process.exit(1);
}
const result = spawnSync(cargo, ['test', '--manifest-path', 'src-tauri/Cargo.toml'], {
  stdio: 'inherit',
  env: { ...process.env, TAURI_CONFIG: JSON.stringify(config) },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
