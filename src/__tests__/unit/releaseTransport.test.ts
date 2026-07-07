/**
 * Unit tests for ReleaseTransport (handlers/transport/high/handleReleaseTransport).
 *
 * SAP-independent: the parser is pure; the handler path uses a mock connection
 * whose makeAdtRequest is a jest.fn(). Covers release-status parsing, unknown
 * response shapes, a successful release summary, and the {supported:false}
 * degradation when the ADT release action is absent (HTTP 404).
 */

import {
  handleReleaseTransport,
  parseReleaseJobResponse,
} from '../../handlers/transport/high/handleReleaseTransport';

// Synthetic fixture — a plausible tm:-namespaced release-report response.
// (Not captured from a live system; shape is intentionally minimal.)
const RELEASED_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm" tm:status="R" tm:status_text="Released">' +
  '<tm:releasereports>' +
  '<tm:releasereport><tm:message>Transport DEVK900123 released successfully</tm:message></tm:releasereport>' +
  '</tm:releasereports>' +
  '</tm:root>';

const UNKNOWN_XML =
  '<?xml version="1.0"?><weird:doc xmlns:weird="urn:x"><foo>bar</foo></weird:doc>';

function textOf(result: any): string {
  return result?.content?.[0]?.text ?? '';
}

describe('parseReleaseJobResponse', () => {
  it('extracts status and messages from a released-report response', () => {
    const parsed = parseReleaseJobResponse(RELEASED_XML);
    expect(parsed.status).toBe('R');
    expect(parsed.statusText).toBe('Released');
    expect(parsed.messages.join(' ')).toContain('released successfully');
  });

  it('yields nulls plus a raw excerpt for an unrecognized shape', () => {
    const parsed = parseReleaseJobResponse(UNKNOWN_XML);
    expect(parsed.status).toBeNull();
    expect(parsed.statusText).toBeNull();
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toContain('weird:doc');
  });

  it('handles empty input without throwing', () => {
    const parsed = parseReleaseJobResponse('');
    expect(parsed.status).toBeNull();
    expect(parsed.messages).toHaveLength(0);
  });
});

describe('handleReleaseTransport', () => {
  function makeContext(makeAdtRequest: jest.Mock) {
    return {
      connection: { makeAdtRequest } as any,
      logger: { info: jest.fn(), debug: jest.fn(), error: jest.fn() } as any,
    };
  }

  it('returns a success summary carrying the SAP-reported status', async () => {
    const makeAdtRequest = jest
      .fn()
      .mockResolvedValue({ data: RELEASED_XML, status: 200 });
    const result = await handleReleaseTransport(
      makeContext(makeAdtRequest) as any,
      { transport_number: 'DEVK900123' },
    );

    expect(result.isError).toBe(false);
    const payload = JSON.parse(textOf(result));
    expect(payload.success).toBe(true);
    expect(payload.supported).toBe(true);
    expect(payload.status).toBe('R');
    expect(makeAdtRequest).toHaveBeenCalledTimes(1);
    // The release action must POST to the newreleasejobs sub-resource.
    const callArg = makeAdtRequest.mock.calls[0][0];
    expect(callArg.method).toBe('POST');
    expect(callArg.url).toContain('/newreleasejobs');
    expect(callArg.url).toContain('DEVK900123');
  });

  it('degrades to { supported: false } on HTTP 404 (action absent)', async () => {
    const makeAdtRequest = jest
      .fn()
      .mockRejectedValue({ response: { status: 404 } });
    const result = await handleReleaseTransport(
      makeContext(makeAdtRequest) as any,
      { transport_number: 'DEVK900123' },
    );

    expect(result.isError).toBe(false);
    const payload = JSON.parse(textOf(result));
    expect(payload.supported).toBe(false);
    expect(payload.hint).toMatch(/SE09|SE10|STMS/);
  });
});
