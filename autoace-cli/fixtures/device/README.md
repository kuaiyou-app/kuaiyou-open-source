# Device skill fixtures

Engine regression JSON and the ADB helper used to drive them on a device. **Not** the public skill catalog.

- Importable catalog lives in repo-root `skills/`.
- These files may contain `test_*` ids, Toutiao-specific copy, or `maxExecutions: 0` loops that must not ship as community examples.
- Offline lint still runs here via `scripts/validate-skills.mjs`.
