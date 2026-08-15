import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DRIVER_ID_FORMAT_ERROR,
  normalizeDriverId,
  parseDriverIdForLogin,
  isDriverIdLoginFormat,
  driverIdsMatch,
  extractDriverIdFromRecord,
  looksLikeCompanyId,
} from '../lib/driverIdNormalize.ts';

describe('normalizeDriverId (D-prefix only)', () => {
  it('normalizes D-prefix variants to D001', () => {
    assert.equal(normalizeDriverId('D001'), 'D001');
    assert.equal(normalizeDriverId('d001'), 'D001');
    assert.equal(normalizeDriverId('D1'), 'D001');
    assert.equal(normalizeDriverId('d1'), 'D001');
    assert.equal(normalizeDriverId(' D002 '), 'D002');
  });

  it('does not invent a D-prefix for bare numbers', () => {
    assert.equal(normalizeDriverId('001'), '001');
    assert.equal(normalizeDriverId('1'), '1');
    assert.equal(normalizeDriverId('12'), '12');
  });

  it('strips common separators on D-prefix ids', () => {
    assert.equal(normalizeDriverId('D-001'), 'D001');
    assert.equal(normalizeDriverId('D 001'), 'D001');
  });

  it('leaves non-ID tokens alone', () => {
    assert.equal(normalizeDriverId('not-an-id'), 'not-an-id');
  });
});

describe('parseDriverIdForLogin (strict login format)', () => {
  it('accepts owner-panel style D001', () => {
    assert.equal(parseDriverIdForLogin('D001'), 'D001');
    assert.equal(parseDriverIdForLogin('d001'), 'D001');
    assert.equal(parseDriverIdForLogin('D1'), 'D001');
  });

  it('rejects bare numbers with a clear message (no login attempt)', () => {
    for (const bad of ['001', '1', '12', '2']) {
      assert.throws(() => parseDriverIdForLogin(bad), (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, DRIVER_ID_FORMAT_ERROR);
        return true;
      });
    }
  });

  it('rejects other invalid tokens with the same clear message', () => {
    for (const bad of ['not-an-id', 'DD001', 'D', '']) {
      assert.throws(() => parseDriverIdForLogin(bad), (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, DRIVER_ID_FORMAT_ERROR);
        return true;
      });
    }
  });

  it('isDriverIdLoginFormat matches D-prefix only', () => {
    assert.equal(isDriverIdLoginFormat('D001'), true);
    assert.equal(isDriverIdLoginFormat('001'), false);
    assert.equal(isDriverIdLoginFormat('1'), false);
  });
});

describe('driverIdsMatch + extract', () => {
  it('matches D-prefix equivalents only (not bare 1 / 001)', () => {
    assert.equal(driverIdsMatch('D001', 'd1'), true);
    assert.equal(driverIdsMatch('D001', 'D001'), true);
    assert.equal(driverIdsMatch('D001', '1'), false);
    assert.equal(driverIdsMatch('D001', '001'), false);
    assert.equal(driverIdsMatch('D001', 'D002'), false);
  });

  it('extracts D-prefixed ids from id, driverId, or dispatcherId', () => {
    assert.equal(extractDriverIdFromRecord({ dispatcherId: 'D001' }), 'D001');
    assert.equal(extractDriverIdFromRecord({ id: 'D002' }), 'D002');
    // Bare stored values are not auto-prefixed anymore
    assert.equal(extractDriverIdFromRecord({ driverId: '3' }), '3');
  });

  it('looksLikeCompanyId accepts numeric company ids only', () => {
    assert.equal(looksLikeCompanyId('860869'), true);
    assert.equal(looksLikeCompanyId('Abdullah Gul'), false);
    assert.equal(looksLikeCompanyId('D001'), false);
  });
});
