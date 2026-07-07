/**
 * Regression tests for the 4.8.3 keychain bug (commit 244928a).
 *
 * EnvFileSessionStore reads SAP_PASSWORD raw from disk and does not know
 * about keychain:<service>/<account> references, so the v2 broker path once
 * seeded the literal reference string as the Basic Auth password —
 * 401 → account lockout after 3 tries. These tests pin the fix: every value
 * seeded into a session store must be the resolved plaintext.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function writeTempEnv(lines: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brokerfactory-test-'));
  const envPath = path.join(dir, 'profile.env');
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
  return envPath;
}

function mockKeyringWith(store: Record<string, string>): void {
  jest.doMock(
    '@napi-rs/keyring',
    () => ({
      Entry: class {
        constructor(
          public service: string,
          public account: string,
        ) {}
        getPassword() {
          return store[`${this.service}::${this.account}`] ?? null;
        }
      },
    }),
    { virtual: true },
  );
}

describe('brokerFactory — keychain password resolution (4.8.3 regression)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('loadEnvFileIntoSessionStore seeds resolved plaintext, never the keychain literal', async () => {
    mockKeyringWith({ 'sc4sap::HK-QA/DEVELOPER': 'S3cret!' });

    const envPath = writeTempEnv([
      'SAP_URL=https://sap.example.com:44300',
      'SAP_CLIENT=100',
      'SAP_USERNAME=DEVELOPER',
      'SAP_PASSWORD=keychain:sc4sap/HK-QA/DEVELOPER',
    ]);

    const { AuthBrokerFactory } = require('../../lib/auth/brokerFactory');
    const factory = new AuthBrokerFactory({ transportType: 'stdio' });

    const setConnectionConfig = jest.fn().mockResolvedValue(undefined);
    const fakeBroker = { sessionStore: { setConnectionConfig } };

    const authType = await (factory as any).loadEnvFileIntoSessionStore(
      envPath,
      'default',
      fakeBroker,
      undefined,
    );

    expect(authType).toBe('basic');
    expect(setConnectionConfig).toHaveBeenCalledTimes(1);
    const [destination, config] = setConnectionConfig.mock.calls[0];
    expect(destination).toBe('default');
    expect(config.username).toBe('DEVELOPER');
    expect(config.password).toBe('S3cret!');
    expect(config.password).not.toMatch(/^keychain:/);
  });

  it('loadEnvFileIntoSessionStore passes plaintext passwords through unchanged', async () => {
    const envPath = writeTempEnv([
      'SAP_URL=https://sap.example.com:44300',
      'SAP_CLIENT=100',
      'SAP_USERNAME=DEVELOPER',
      'SAP_PASSWORD=PlainPass123',
    ]);

    const { AuthBrokerFactory } = require('../../lib/auth/brokerFactory');
    const factory = new AuthBrokerFactory({ transportType: 'stdio' });

    const setConnectionConfig = jest.fn().mockResolvedValue(undefined);
    const fakeBroker = { sessionStore: { setConnectionConfig } };

    await (factory as any).loadEnvFileIntoSessionStore(
      envPath,
      'default',
      fakeBroker,
      undefined,
    );

    const [, config] = setConnectionConfig.mock.calls[0];
    expect(config.password).toBe('PlainPass123');
  });

  it('loadEnvFileIntoSessionStore surfaces a missing keychain entry as an error (never a silent literal)', async () => {
    mockKeyringWith({});

    const envPath = writeTempEnv([
      'SAP_URL=https://sap.example.com:44300',
      'SAP_USERNAME=DEVELOPER',
      'SAP_PASSWORD=keychain:sc4sap/MISSING/DEVELOPER',
    ]);

    const { AuthBrokerFactory } = require('../../lib/auth/brokerFactory');
    const { KeychainEntryNotFoundError } = require('../../lib/secrets');
    const factory = new AuthBrokerFactory({ transportType: 'stdio' });

    const setConnectionConfig = jest.fn().mockResolvedValue(undefined);
    const fakeBroker = { sessionStore: { setConnectionConfig } };

    await expect(
      (factory as any).loadEnvFileIntoSessionStore(
        envPath,
        'default',
        fakeBroker,
        undefined,
      ),
    ).rejects.toThrow(KeychainEntryNotFoundError);
    expect(setConnectionConfig).not.toHaveBeenCalled();
  });
});
