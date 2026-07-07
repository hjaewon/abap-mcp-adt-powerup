/**
 * Unit tests for return_error's structured SAP-error surfacing (utils.ts).
 *
 * SAP-independent: constructs AxiosError / Error instances directly — no live
 * connection. Covers the 4.13.0 change where ADT `<exc:exception>` XML in an
 * HTTP error body is parsed into readable `SAP Error: ... [HTTP nnn]` text
 * instead of a 2000-char raw-XML dump, while non-XML and network-error paths
 * stay exactly as before.
 */

import { AxiosError } from 'axios';
import { return_error } from '../../lib/utils';

function textOf(result: any): string {
  return result?.content?.[0]?.text ?? '';
}

function axiosErrorWithBody(status: number, data: string): AxiosError {
  const err = new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    {
      status,
      statusText: 'Error',
      data,
      headers: {},
      config: {} as any,
    } as any,
  );
  return err;
}

describe('return_error — structured SAP error surfacing', () => {
  it('parses ADT exception XML into a readable SAP Error line with HTTP status', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">' +
      '<namespace id="com.sap.adt"/>' +
      '<type id="ExceptionResourceAlreadyReleased"/>' +
      '<message lang="EN">Transport ABCK900123 is already released</message>' +
      '<localizedMessage lang="EN">Transport ABCK900123 is already released</localizedMessage>' +
      '</exc:exception>';

    const out = textOf(return_error(axiosErrorWithBody(400, xml)));

    expect(out).toContain('SAP Error:');
    expect(out).toContain('Transport ABCK900123 is already released');
    expect(out).toContain('[HTTP 400]');
    // Raw XML must not leak through.
    expect(out).not.toContain('<exc:exception');
  });

  it('leaves a plain-text error body untouched (truncated, no XML parsing)', () => {
    const out = textOf(
      axiosPlainText('Internal error: object is locked by another user'),
    );
    expect(out).toContain('Internal error: object is locked by another user');
    expect(out).not.toContain('SAP Error:');
    expect(out).not.toContain('[HTTP');
  });

  it('preserves the friendly DNS mapping for ENOTFOUND network errors', () => {
    const out = textOf(
      return_error(new Error('getaddrinfo ENOTFOUND sap.example.com')),
    );
    expect(out).toContain('DNS resolution failed');
    expect(out).toContain('sap.example.com');
  });
});

function axiosPlainText(body: string) {
  return return_error(axiosErrorWithBody(500, body));
}
