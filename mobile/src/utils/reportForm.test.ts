import { describe, it, expect } from 'vitest';
import { validateReportForm } from './reportForm';

// The report-form gate order + messages (extracted verbatim from ReportScreen).
// Self reports require phone + HKID; proxy reports never block on them (a missing
// ID must never stop a rescue) but still reject a provided-yet-invalid HKID.
const selfBase = { isProxy: false, subjectName: 'Mei', reporterName: '', phone: '98765432', personalId: 'A1234567' };

describe('validateReportForm — self report', () => {
  it('passes with name + phone + valid HKID', () => {
    expect(validateReportForm({ ...selfBase })).toBeNull();
  });
  it('requires a subject name', () => {
    expect(validateReportForm({ ...selfBase, subjectName: '  ' })?.field).toBe('subjectName');
  });
  it('requires a phone', () => {
    expect(validateReportForm({ ...selfBase, phone: '' })?.field).toBe('phone');
  });
  it('requires an HKID', () => {
    expect(validateReportForm({ ...selfBase, personalId: '' })?.field).toBe('personalId');
  });
  it('rejects an invalid HKID', () => {
    expect(validateReportForm({ ...selfBase, personalId: 'nope' })?.message).toBe('report.errHkidInvalid');
  });
});

describe('validateReportForm — proxy report', () => {
  const proxyBase = { isProxy: true, subjectName: 'Subject', reporterName: 'Sister', phone: '', personalId: '' };
  it('passes without phone/HKID (never block a rescue)', () => {
    expect(validateReportForm({ ...proxyBase })).toBeNull();
  });
  it('requires the reporter name', () => {
    expect(validateReportForm({ ...proxyBase, reporterName: ' ' })?.field).toBe('reporterName');
  });
  it('still rejects a provided-but-invalid HKID', () => {
    expect(validateReportForm({ ...proxyBase, personalId: 'bad' })?.field).toBe('personalId');
  });
});
