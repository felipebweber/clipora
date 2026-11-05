import { spawnSync } from 'node:child_process';

// Testes unitários não empacotam sidecars; preserve as demais opções do ambiente.
const config = JSON.parse(process.env.TAURI_CONFIG || '{}');
config.bundle = { ...config.bundle, externalBin: [] };
const result = spawnSync('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml'], {
  stdio: 'inherit',
  env: { ...process.env, TAURI_CONFIG: JSON.stringify(config) },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
