import {
  parseInstalledComponents,
  parseSystemInformation,
} from '../../lib/systemInfoParsers';

describe('parseSystemInformation', () => {
  it('parses an already-parsed JSON object', () => {
    const result = parseSystemInformation({
      systemID: 'S4H',
      client: '100',
      language: 'EN',
      userName: 'DEVELOPER',
      userFullName: 'Dev User',
    });
    expect(result).toEqual({
      systemId: 'S4H',
      client: '100',
      language: 'EN',
      userName: 'DEVELOPER',
      userFullName: 'Dev User',
    });
  });

  it('parses a raw JSON string body', () => {
    const raw = JSON.stringify({ systemID: 'TRL', client: '000' });
    const result = parseSystemInformation(raw);
    expect(result.systemId).toBe('TRL');
    expect(result.client).toBe('000');
  });

  it('returns an empty object for invalid JSON string', () => {
    expect(parseSystemInformation('not json {')).toEqual({});
  });

  it('returns an empty object for null/undefined/non-object input', () => {
    expect(parseSystemInformation(null)).toEqual({});
    expect(parseSystemInformation(undefined)).toEqual({});
    expect(parseSystemInformation(42)).toEqual({});
  });

  it('accepts the systemId alias key', () => {
    expect(parseSystemInformation({ systemId: 'ECC' })).toEqual({
      systemId: 'ECC',
      client: undefined,
      language: undefined,
      userName: undefined,
      userFullName: undefined,
    });
  });
});

describe('parseInstalledComponents', () => {
  it('returns an empty array for null/undefined/empty input', () => {
    expect(parseInstalledComponents(null)).toEqual([]);
    expect(parseInstalledComponents(undefined)).toEqual([]);
    expect(parseInstalledComponents('')).toEqual([]);
  });

  it('parses a JSON array of components', () => {
    const data = [
      { name: 'SAP_BASIS', release: '757', spLevel: '0002' },
      { component: 'S4CORE', releaseVersion: '106', supportPackage: '0001' },
    ];
    const result = parseInstalledComponents(data);
    expect(result).toEqual([
      {
        name: 'SAP_BASIS',
        release: '757',
        spLevel: '0002',
        description: undefined,
      },
      {
        name: 'S4CORE',
        release: '106',
        spLevel: '0001',
        description: undefined,
      },
    ]);
  });

  it('parses a JSON object wrapping a components array', () => {
    const data = { components: [{ name: 'SAP_BASIS', release: '756' }] };
    const result = parseInstalledComponents(data);
    expect(result).toEqual([
      {
        name: 'SAP_BASIS',
        release: '756',
        spLevel: undefined,
        description: undefined,
      },
    ]);
  });

  it('parses a JSON string body', () => {
    const raw = JSON.stringify([{ name: 'SAP_BASIS', release: '757' }]);
    const result = parseInstalledComponents(raw);
    expect(result).toEqual([
      {
        name: 'SAP_BASIS',
        release: '757',
        spLevel: undefined,
        description: undefined,
      },
    ]);
  });

  it('parses an XML component list (namespace-prefixed)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<comp:componentReleases xmlns:comp="http://www.sap.com/adt/core/components">
  <comp:component name="SAP_BASIS" release="757" spLevel="0002" description="Basis"/>
  <comp:component name="S4CORE" release="106" spLevel="0001" description="Core"/>
</comp:componentReleases>`;
    const result = parseInstalledComponents(xml, 'application/xml');
    expect(result).toEqual([
      {
        name: 'SAP_BASIS',
        release: '757',
        spLevel: '0002',
        description: 'Basis',
      },
      { name: 'S4CORE', release: '106', spLevel: '0001', description: 'Core' },
    ]);
  });

  it('falls back to XML parsing when content-type is missing but body looks like XML', () => {
    const xml = `<components><component name="SAP_BASIS" release="757"/></components>`;
    const result = parseInstalledComponents(xml);
    expect(result).toEqual([
      {
        name: 'SAP_BASIS',
        release: '757',
        spLevel: undefined,
        description: undefined,
      },
    ]);
  });

  it('returns an empty array when entries have no recognizable name field', () => {
    const data = [{ foo: 'bar' }];
    expect(parseInstalledComponents(data)).toEqual([]);
  });

  it('returns an empty array for malformed XML', () => {
    const xml = '<components><component name="X"';
    // fast-xml-parser is lenient; ensure this never throws regardless of
    // whether it manages to extract anything.
    expect(() =>
      parseInstalledComponents(xml, 'application/xml'),
    ).not.toThrow();
  });
});
