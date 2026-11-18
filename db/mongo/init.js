// MongoDB setup for the visits collection.
// Run once (idempotent):   docker compose exec -T mongo mongosh --quiet < db/mongo/init.js
// or mount it into /docker-entrypoint-initdb.d/ so the mongo image runs it on first start.
// Works in mongosh. Requires MongoDB 5.0+ (the report pipelines use $dateTrunc).

const health = db.getSiblingDB('health_centre');

const uuid = { bsonType: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' };
const int = { bsonType: ['int', 'long'] };

const snapshotProps = {
  name: { bsonType: 'string', minLength: 1 },
  sex: { enum: ['M', 'F', 'Other'] },
  age_at_visit: { bsonType: ['int', 'long'], minimum: 0, maximum: 130 },
  roll_no: { bsonType: 'string' },
  batch_year: int,
  program: { enum: ['UG', 'PG'] },
  branch_id: int,
  branch_name: { bsonType: 'string' },
  phone_no: { bsonType: 'string' },
  designation: { enum: ['STAFF', 'FACULTY', 'WORKER', 'OTHER'] },
};

const validator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['visit_id', 'patient_id', 'patient_type', 'snapshot', 'date_time', 'health_issue',
      'health_issue_is_custom', 'remedy', 'recorded_by', 'created_at', 'updated_at'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      visit_id: uuid,
      patient_id: uuid,
      patient_type: { enum: ['STUDENT', 'NON_STUDENT'] },
      snapshot: {
        bsonType: 'object',
        required: ['name', 'sex', 'age_at_visit'],
        additionalProperties: false,
        properties: snapshotProps,
      },
      date_time: { bsonType: 'date' },
      health_issue: { bsonType: 'string', minLength: 1 },
      health_issue_is_custom: { bsonType: 'bool' },
      remedy: { bsonType: 'string', minLength: 1 },
      recorded_by: int,
      created_at: { bsonType: 'date' },
      updated_at: { bsonType: 'date' },
    },
    // The snapshot shape must match the patient_type discriminator.
    oneOf: [
      {
        properties: {
          patient_type: { enum: ['STUDENT'] },
          snapshot: { required: ['roll_no', 'batch_year', 'program', 'branch_id', 'branch_name'] },
        },
      },
      {
        properties: {
          patient_type: { enum: ['NON_STUDENT'] },
          snapshot: { required: ['phone_no', 'designation'] },
        },
      },
    ],
  },
};

if (health.getCollectionNames().includes('visits')) {
  health.runCommand({ collMod: 'visits', validator, validationLevel: 'strict', validationAction: 'error' });
  print('visits: validator updated');
} else {
  health.createCollection('visits', { validator, validationLevel: 'strict', validationAction: 'error' });
  print('visits: collection created');
}

const visits = health.getCollection('visits');
visits.createIndex({ visit_id: 1 }, { unique: true, name: 'visit_id_unique' });
visits.createIndex({ patient_id: 1, date_time: -1 }, { name: 'patient_id_date_time' });
visits.createIndex({ date_time: 1 }, { name: 'date_time' });
visits.createIndex({ health_issue: 1 }, { name: 'health_issue' });
visits.createIndex({ 'snapshot.branch_id': 1 }, { name: 'snapshot_branch_id' });
visits.createIndex({ 'snapshot.batch_year': 1 }, { name: 'snapshot_batch_year' });
print('visits: indexes ensured');
