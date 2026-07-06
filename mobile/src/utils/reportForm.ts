import { isValidHKID } from './hkid';

/**
 * Pure validation for the report form (extracted verbatim from
 * ReportScreen.onSubmit so the gate order and messages stay identical).
 *
 * Returns `null` when the form is valid, otherwise the first failing field and
 * its user-facing error as an i18n message KEY — pass it through `t()` to get
 * the localized text.
 */

export interface ReportFormFields {
  isProxy: boolean;
  subjectName: string;
  reporterName: string;
  phone: string;
  personalId: string;
}

export interface ReportFormError {
  field?: string;
  /** i18n message key (resolve with `t(message)`). */
  message: string;
}

export function validateReportForm(form: ReportFormFields): ReportFormError | null {
  if (!form.subjectName.trim()) {
    return {
      field: 'subjectName',
      message: form.isProxy ? 'report.errSubjectProxy' : 'report.errSubjectSelf',
    };
  }
  if (form.isProxy && !form.reporterName.trim()) {
    return { field: 'reporterName', message: 'report.errReporter' };
  }
  // Phone + HKID are required basic data for self-reports. For proxy
  // reports they are requested but not blocking — the reporter may not
  // know the subject's HKID, and a missing ID must never stop a rescue.
  if (!form.isProxy) {
    if (!form.phone.trim()) {
      return { field: 'phone', message: 'report.errPhone' };
    }
    if (!form.personalId.trim()) {
      return { field: 'personalId', message: 'report.errHkidRequired' };
    }
  }
  if (form.personalId.trim() && !isValidHKID(form.personalId)) {
    return { field: 'personalId', message: 'report.errHkidInvalid' };
  }
  return null;
}
