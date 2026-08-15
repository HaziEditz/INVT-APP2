import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeDriverId,
  driverIdsMatch,
  extractDriverIdFromRecord,
  looksLikeCompanyId,
} from '../lib/driverIdNormalize.ts';

describe('normalizeDriverId (ID login)', () => {
  it('normalizes D-prefix variants to D001', () => {
    assert.equal(normalizeDriverId('D001'), 'D001');
    assert.equal(normalizeDriverId('d001'), 'D001');
    assert.equal(normalizeDriverId('D1'), 'D001');
    assert.equal(normalizeDriverId('d1'), 'D001');
    assert.equal(normalizeDriverId(' D002 '), 'D002');
  });

  it('normalizes bare numeric IDs drivers often type without D', () => {
    assert.equal(normalizeDriverId('001'), 'D001');
    assert.equal(normalizeDriverId('1'), 'D001');
    assert.equal(normalizeDriverId('12'), 'D012');
    assert.equal(normalizeDriverId('2'), 'D002');
  });

  it('strips common separators', () => {
    assert.equal(normalizeDriverId('D-001'), 'D001');
    assert.equal(normalizeDriverId('D 001'), 'D001');
  });

  it('leaves non-ID tokens alone', () => {
    assert.equal(normalizeDriverId('not-an-id'), 'not-an-id');
  });
});

describe('driverIdsMatch + extract', () => {
  it('matches D001 with bare 1 / 001 / d1', () => {
    assert.equal(driverIdsMatch('D001', '1'), true);
    assert.equal(driverIdsMatch('D001', '001'), true);
    assert.equal(driverIdsMatch('D001', 'd1'), true);
    assert.equal(driverIdsMatch('D001', 'D002'), false);
  });

  it('extracts from id, driverId, or dispatcherId', () => {
    assert.equal(extractDriverIdFromRecord({ dispatcherId: 'D001' }), 'D001');
    assert.equal(extractDriverIdFromRecord({ id: 'D002' }), 'D002');
    assert.equal(extractDriverIdFromRecord({ driverId: '3' }), 'D003');
  });

  it('looksLikeCompanyId accepts numeric company ids only', () => {
    assert.equal(looksLikeCompanyId('860869'), true);
    assert.equal(looksLikeCompanyId('Abdullah Gul'), false);
    assert.equal(looksLikeCompanyId('D001'), false);
  });
});
