// SYNTHETIC fixtures. Names are invented, ids are fixed, nothing is a real person.
export const student = {
  patient_id: '2f1a6c1e-8f0b-4a53-9a77-3d1b5e0c9a01', patient_type: 'STUDENT', name: 'Sample Alpha', dob: '2006-03-14',
  age: 20, age_is_estimated: false, sex: 'F', roll_no: '251210901', batch_year: 2025, program: 'UG', branch_id: 1,
  branch_code: '210', branch_name: 'Computer Science and Engineering', rfid_id: 'SAMPLE0001',
};

export const nonStudent = {
  patient_id: '7c3e9d52-1b64-4f0a-8e21-5a9c0d7b3e02', patient_type: 'NON_STUDENT', name: 'Sample Bravo', age: 41, age_is_estimated: true,
  sex: 'M', phone_no: '9000000001', designation: 'STAFF', age_at_registration: 40, registered_on: '2025-06-01',
};

export const other = {
  patient_id: 'a4d1b0f3-6e22-4c89-b5d7-0c8e2f1a6b03', patient_type: 'NON_STUDENT', name: 'Sample Charlie', age: 30, age_is_estimated: true,
  sex: 'Other', phone_no: '9000000002', designation: 'WORKER', age_at_registration: 30, registered_on: '2026-11-01',
};

const v = (visit_id, patient, date_time, health_issue, remedy, custom = false) => ({
  visit_id, patient_id: patient.patient_id, patient_type: patient.patient_type, snapshot: { name: patient.name },
  date_time: new Date(date_time), health_issue, health_issue_is_custom: custom, remedy, recorded_by: 2,
  created_at: new Date(date_time), updated_at: new Date(date_time),
});

export const studentVisits = [
  v('b1c2d3e4-0001-4a5b-8c6d-7e8f9a0b1c01', student, '2026-11-16T05:35:00.000Z', 'Fever', 'Paracetamol 500mg'),
  v('b1c2d3e4-0002-4a5b-8c6d-7e8f9a0b1c02', student, '2026-11-10T09:10:00.000Z', 'Headache', 'Rest and hydration advised'),
];
export const nonStudentVisits = [
  v('b1c2d3e4-0003-4a5b-8c6d-7e8f9a0b1c03', nonStudent, '2026-11-12T04:50:00.000Z', 'Insect bite', 'Antiseptic dressing', true),
];
export const otherVisits = [
  v('b1c2d3e4-0004-4a5b-8c6d-7e8f9a0b1c04', other, '2026-11-13T10:20:00.000Z', 'Cold', 'Cetirizine 10mg'),
];
