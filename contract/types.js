/**
 * API types (JSDoc). They mirror the repository and HTTP contracts and openapi.yaml.
 *
 * @typedef {'ADMIN'|'STAFF'} Role
 * @typedef {'M'|'F'|'Other'} Sex
 * @typedef {'STUDENT'|'NON_STUDENT'} PatientType
 * @typedef {'UG'|'PG'} Program
 * @typedef {'STAFF'|'FACULTY'|'WORKER'|'OTHER'} Designation
 *
 * @typedef {Object} User
 * @property {number} user_id
 * @property {string} username
 * @property {Role} role
 *
 * @typedef {Object} PatientView
 * @property {string} patient_id
 * @property {PatientType} patient_type
 * @property {string} name
 * @property {string} [dob]                 YYYY-MM-DD, students only
 * @property {number} age
 * @property {boolean} age_is_estimated
 * @property {Sex} sex
 * @property {string} [roll_no]
 * @property {number} [batch_year]
 * @property {Program} [program]
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
 * @property {Program} [program]
 * @property {number} [branch_id]
 * @property {string} [branch_name]
 * @property {string} [phone_no]
 * @property {Designation} [designation]
 *
 * @typedef {Object} Visit
 * @property {string} visit_id
 * @property {string} patient_id
 * @property {PatientType} patient_type
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
 * @typedef {{patient_id:string, name:string, patient_type:PatientType, count:number}} FrequentVisitorRow
 * @typedef {{branch_id:number, branch_name:string, count:number}} BranchRow
 * @typedef {{batch_year:number, count:number}} BatchRow
 * @typedef {{bucket:string, count:number}} TimeBucketRow
 * @typedef {{code:string, label:string}} HealthIssue
 * @typedef {{branch_id:number, branch_code:string, branch_name:string}} Branch
 *
 * An AppError (defined in db/lib/errors.js, exported from db/index.js) has:
 * @typedef {Error & {code:string, status:number, details:Object}} AppError
 */

export {};
