import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('start-production.sh', () => {
  const script = resolve(__dirname, '../../scripts/start-production.sh');
  let fixtureDir: string;
  let captureFile: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'trustpay-startup-test-'));
    captureFile = join(fixtureDir, 'commands.log');
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  const installCommand = (name: string, body: string) => {
    const path = join(fixtureDir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  };

  const start = (runMigrations: string) =>
    spawnSync('/bin/sh', [script], {
      env: {
        ...process.env,
        PATH: `${fixtureDir}:/usr/bin:/bin`,
        CAPTURE_FILE: captureFile,
        RUN_MIGRATIONS_ON_STARTUP: runMigrations,
      },
      encoding: 'utf8',
    });

  it('deploys pending migrations before starting the staging server', () => {
    installCommand('npx', `printf 'npx:%s\\n' "$*" >> "$CAPTURE_FILE"`);
    installCommand(
      'dumb-init',
      `printf 'dumb-init:%s\\n' "$*" >> "$CAPTURE_FILE"`,
    );

    const result = start('true');

    expect(result.status).toBe(0);
    expect(readFileSync(captureFile, 'utf8')).toBe(
      'npx:prisma migrate deploy\ndumb-init:-- node dist/src/main.js\n',
    );
  });

  it('does not start the server when a migration fails', () => {
    installCommand('npx', 'exit 23');
    installCommand(
      'dumb-init',
      `printf 'unexpected-server-start\\n' >> "$CAPTURE_FILE"`,
    );

    const result = start('true');

    expect(result.status).toBe(23);
    expect(() => readFileSync(captureFile, 'utf8')).toThrow();
  });

  it('starts without migrations when startup migrations are disabled', () => {
    installCommand(
      'npx',
      `printf 'unexpected-migration\\n' >> "$CAPTURE_FILE"`,
    );
    installCommand(
      'dumb-init',
      `printf 'dumb-init:%s\\n' "$*" >> "$CAPTURE_FILE"`,
    );

    const result = start('false');

    expect(result.status).toBe(0);
    expect(readFileSync(captureFile, 'utf8')).toBe(
      'dumb-init:-- node dist/src/main.js\n',
    );
  });

  it('rejects an invalid startup migration flag', () => {
    installCommand('npx', `printf 'unexpected-migration\n' >> "$CAPTURE_FILE"`);
    installCommand(
      'dumb-init',
      `printf 'unexpected-server-start\n' >> "$CAPTURE_FILE"`,
    );

    const result = start('yes');

    expect(result.status).toBe(64);
    expect(result.stderr).toContain(
      'RUN_MIGRATIONS_ON_STARTUP must be true or false',
    );
    expect(() => readFileSync(captureFile, 'utf8')).toThrow();
  });
});
