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

describe('verify-backup-restore.sh', () => {
  const script = resolve(__dirname, '../../scripts/verify-backup-restore.sh');
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'trustpay-restore-script-test-'));
    const commands: Record<string, string> = {
      pg_dump: `#!/bin/sh
printf '%s\n' "$@" > "$CAPTURE_DIR/pg_dump.args"
for argument in "$@"; do
  case "$argument" in
    --file=*) backup_file="\${argument#--file=}" ;;
  esac
done
printf 'test backup\n' > "$backup_file"
`,
      pg_restore: `#!/bin/sh
printf '%s\n' "$@" >> "$CAPTURE_DIR/pg_restore.args"
`,
      psql: `#!/bin/sh
printf '%s\n' "$@" > "$CAPTURE_DIR/psql.args"
printf '1\n'
`,
    };

    for (const [name, contents] of Object.entries(commands)) {
      const path = join(fixtureDir, name);
      writeFileSync(path, contents);
      chmodSync(path, 0o755);
    }
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('removes Prisma-only schema parameters before invoking PostgreSQL tools', () => {
    const result = spawnSync(script, [], {
      env: {
        ...process.env,
        PATH: `${fixtureDir}:/usr/bin:/bin`,
        CAPTURE_DIR: fixtureDir,
        DATABASE_URL:
          'postgresql://db-user:db-pass@localhost:5432/trustpay_test?schema=public&sslmode=disable',
        RESTORE_DATABASE_URL:
          'postgresql://db-user:db-pass@localhost:5432/trustpay_restore?sslmode=disable&schema=public',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const captured = [
      readFileSync(join(fixtureDir, 'pg_dump.args'), 'utf8'),
      readFileSync(join(fixtureDir, 'pg_restore.args'), 'utf8'),
      readFileSync(join(fixtureDir, 'psql.args'), 'utf8'),
    ].join('\n');

    expect(captured).not.toContain('schema=');
    expect(captured).toContain('sslmode=disable');
  });
});
