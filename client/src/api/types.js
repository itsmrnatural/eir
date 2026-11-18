/**
 * JSDoc types for the API layer. They mirror the API contract and are copied here
 * (not imported from contract/) because the Docker build context is client/ only.
 *
 * @typedef {'ADMIN'|'STAFF'} Role
 * @typedef {{user_id:number, username:string, role:Role}} User
 * @typedef {'M'|'F'|'Other'} Sex
 * @typedef {'STAFF'|'FACULTY'|'WORKER'|'OTHER'} Designation
 *
 * @typedef {Object} PatientView
 * @property {string} patient_id
 * @property {'STUDENT'|'NON_STUDENT'} patient_type
 * @property {string} name
 * @property {string} [dob]            YYYY-MM-DD, students only
 * @property {number} age
 * @property {boolean} age_is_estimated
 * @property {Sex} sex
 * @property {string} [roll_no]
 * @property {number} [batch_year]
 * @property {'UG'|'PG'} [program]
 * @property {number} [branch_id]
 * @property {string} [branch_code]
 * @property {string} [branch_name]
 * @property {string} [phone_no]
 * @property {Designation} [designation]
 * @property {string} [rfid_id]
 * @property {number} [age_at_registration] non-students only
 * @property {string} [registered_on]       non-students only, YYYY-MM-DD
 *
 * @typedef {Object} VisitSnapshot
 * @property {string} name
 * @property {Sex} sex
 * @property {number} age_at_visit
 * @property {string} [roll_no]
 * @property {number} [batch_year]
 * @property {string} [program]
 * @property {number} [branch_id]
 * @property {string} [branch_name]
 * @property {string} [phone_no]
 * @property {string} [designation]
 *
 * @typedef {Object} Visit
 * @property {string} visit_id
 * @property {string} patient_id
 * @property {'STUDENT'|'NON_STUDENT'} patient_type
 * @property {VisitSnapshot} snapshot
 * @property {string} date_time        ISO-8601 UTC, set by the server
 * @property {string} health_issue
 * @property {boolean} health_issue_is_custom
 * @property {string} remedy
 * @property {number} recorded_by
 * @property {string} created_at
 * @property {string} updated_at
 *
 * @typedef {{health_issue:string, count:number}} CommonIssueRow
 * @typedef {{hour:number, count:number}} PeakHourRow
 * @typedef {{patient_id:string, name:string, patient_type:string, count:number}} FrequentVisitorRow
 * @typedef {{branch_id:number, branch_name:string, count:number}} BranchRow
 * @typedef {{batch_year:number, count:number}} BatchRow
 * @typedef {{bucket:string, count:number}} TimeBucketRow
 * @typedef {{code:string, label:string}} HealthIssue
 * @typedef {{branch_id:number, branch_code:string, branch_name:string}} Branch
 */
export {};
