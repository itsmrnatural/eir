// A small structural checker for the FHIR R4 (4.0.1) resources this project emits.
// It is not the official HL7 validator and not a full schema validation: it encodes, from the R4 spec,
//   * which top-level elements each resource may have (typos / R5 names are caught),
//   * cardinality of the elements we use (required / single / array),
//   * primitive formats (id, code, uri, date, dateTime, instant),
//   * the value sets for the coded elements we use,
//   * Bundle rules: type=collection, no `total` (bdl-1), unique fullUrl (bdl-7), fullUrl matches resource id,
//     every `urn:uuid:` reference resolves inside the bundle,
//   * JSON rules: no null, no empty arrays/objects, no empty strings.
// scripts/validate-hl7.sh runs the official validator for a real conformance check.

const RE = {
  id: /^[A-Za-z0-9\-.]{1,64}$/,
  code: /^[^\s]+(\s[^\s]+)*$/,
  uri: /^\S+$/,
  date: /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?$/,
  dateTime: /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?$/,
};

const VALUE_SETS = {
  'Patient.gender': ['male', 'female', 'other', 'unknown'],
  'Encounter.status': ['planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled', 'entered-in-error', 'unknown'],
  'MedicationStatement.status': ['active', 'completed', 'entered-in-error', 'intended', 'stopped', 'on-hold', 'unknown', 'not-taken'],
  'Bundle.type': ['document', 'message', 'transaction', 'transaction-response', 'batch', 'batch-response', 'history', 'searchset', 'collection'],
  'ContactPoint.system': ['phone', 'fax', 'email', 'pager', 'url', 'sms', 'other'],
  'Identifier.use': ['usual', 'official', 'temp', 'secondary', 'old'],
  'HumanName.use': ['usual', 'official', 'temp', 'nickname', 'anonymous', 'old', 'maiden'],
};

// element: type | 'Type*' for arrays | 'any' for allowed-but-not-checked
const TYPES = {
  Reference: { reference: 'string', type: 'uri', identifier: 'any', display: 'string' },
  Coding: { system: 'uri', version: 'string', code: 'code', display: 'string', userSelected: 'boolean' },
  CodeableConcept: { coding: 'Coding*', text: 'string' },
  Identifier: { use: 'code', type: 'CodeableConcept', system: 'uri', value: 'string', period: 'Period', assigner: 'Reference' },
  HumanName: { use: 'code', text: 'string', family: 'string', given: 'string*', prefix: 'string*', suffix: 'string*', period: 'Period' },
  ContactPoint: { system: 'code', value: 'string', use: 'code', rank: 'positiveInt', period: 'Period' },
  Period: { start: 'dateTime', end: 'dateTime' },
};
const COMMON = { resourceType: 'code', id: 'id', meta: 'any', implicitRules: 'uri', language: 'code', text: 'any', contained: 'any*', extension: 'any*', modifierExtension: 'any*' };
const RESOURCES = {
  Patient: {
    required: [],
    el: { ...COMMON, identifier: 'Identifier*', active: 'boolean', name: 'HumanName*', telecom: 'ContactPoint*', gender: 'code', birthDate: 'date', deceasedBoolean: 'boolean', deceasedDateTime: 'dateTime', address: 'any*', maritalStatus: 'any', multipleBirthBoolean: 'boolean', multipleBirthInteger: 'any', photo: 'any*', contact: 'any*', communication: 'any*', generalPractitioner: 'Reference*', managingOrganization: 'Reference', link: 'any*' },
  },
  Encounter: {
    required: ['status', 'class'],
    el: { ...COMMON, identifier: 'Identifier*', status: 'code', statusHistory: 'any*', class: 'Coding', classHistory: 'any*', type: 'CodeableConcept*', serviceType: 'CodeableConcept', priority: 'CodeableConcept', subject: 'Reference', episodeOfCare: 'Reference*', basedOn: 'Reference*', participant: 'any*', appointment: 'Reference*', period: 'Period', length: 'any', reasonCode: 'CodeableConcept*', reasonReference: 'Reference*', diagnosis: 'any*', account: 'Reference*', hospitalization: 'any', location: 'any*', serviceProvider: 'Reference', partOf: 'Reference' },
  },
  Condition: {
    required: ['subject'],
    el: { ...COMMON, identifier: 'Identifier*', clinicalStatus: 'CodeableConcept', verificationStatus: 'CodeableConcept', category: 'CodeableConcept*', severity: 'CodeableConcept', code: 'CodeableConcept', bodySite: 'CodeableConcept*', subject: 'Reference', encounter: 'Reference', onsetDateTime: 'dateTime', onsetAge: 'any', onsetPeriod: 'Period', onsetRange: 'any', onsetString: 'string', abatementDateTime: 'dateTime', abatementAge: 'any', abatementPeriod: 'Period', abatementRange: 'any', abatementString: 'string', recordedDate: 'dateTime', recorder: 'Reference', asserter: 'Reference', stage: 'any*', evidence: 'any*', note: 'any*' },
  },
  MedicationStatement: {
    required: ['status', 'subject'],
    requiredOneOf: [['medicationCodeableConcept', 'medicationReference']],
    el: { ...COMMON, identifier: 'Identifier*', basedOn: 'Reference*', partOf: 'Reference*', status: 'code', statusReason: 'CodeableConcept*', category: 'CodeableConcept', medicationCodeableConcept: 'CodeableConcept', medicationReference: 'Reference', subject: 'Reference', context: 'Reference', effectiveDateTime: 'dateTime', effectivePeriod: 'Period', dateAsserted: 'dateTime', informationSource: 'Reference', derivedFrom: 'Reference*', reasonCode: 'CodeableConcept*', reasonReference: 'Reference*', note: 'any*', dosage: 'any*' },
  },
  Bundle: {
    required: ['type'],
    el: { ...COMMON, identifier: 'Identifier', type: 'code', timestamp: 'instant', total: 'unsignedInt', link: 'any*', entry: 'any*', signature: 'any' },
  },
};
const REFERENCE_TARGETS = {
  'Encounter.subject': ['Patient', 'Group'], 'Condition.subject': ['Patient', 'Group'], 'Condition.encounter': ['Encounter'],
  'MedicationStatement.subject': ['Patient', 'Group'], 'MedicationStatement.context': ['Encounter', 'EpisodeOfCare'],
};

function checkPrimitive(type, value, path, issues, ctxName) {
  const bad = (m) => issues.push(`${path}: ${m}`);
  switch (type) {
    case 'string': if (typeof value !== 'string' || value.trim() === '') bad('must be a non-empty string'); break;
    case 'boolean': if (typeof value !== 'boolean') bad('must be a boolean'); break;
    case 'positiveInt': case 'unsignedInt': if (!Number.isInteger(value) || value < (type === 'positiveInt' ? 1 : 0)) bad(`must be a ${type}`); break;
    case 'id': if (typeof value !== 'string' || !RE.id.test(value)) bad('is not a valid FHIR id'); break;
    case 'uri': if (typeof value !== 'string' || !RE.uri.test(value)) bad('is not a valid uri'); break;
    case 'code':
      if (typeof value !== 'string' || !RE.code.test(value)) bad('is not a valid code');
      else if (VALUE_SETS[ctxName] && !VALUE_SETS[ctxName].includes(value)) bad(`"${value}" is not in the required value set (${VALUE_SETS[ctxName].join('|')})`);
      break;
    case 'date': if (typeof value !== 'string' || !RE.date.test(value)) bad('is not a valid FHIR date'); break;
    case 'dateTime': if (typeof value !== 'string' || !RE.dateTime.test(value)) bad('is not a valid FHIR dateTime'); break;
    case 'instant': if (typeof value !== 'string' || !RE.dateTime.test(value) || value.length < 20) bad('is not a valid FHIR instant'); break;
    default: break;
  }
}

const arr = (x) => (Array.isArray(x) ? x : []);

function checkNoEmpty(value, path, issues) {
  if (value === null) issues.push(`${path}: null is not allowed in FHIR JSON`);
  else if (Array.isArray(value)) {
    if (value.length === 0) issues.push(`${path}: empty array is not allowed`);
    value.forEach((x, i) => checkNoEmpty(x, `${path}[${i}]`, issues));
  } else if (typeof value === 'object') {
    if (Object.keys(value).length === 0) issues.push(`${path}: empty object is not allowed`);
    for (const [k, x] of Object.entries(value)) checkNoEmpty(x, `${path}.${k}`, issues);
  } else if (value === '') issues.push(`${path}: empty string is not allowed`);
}

function checkTyped(typeSpec, value, path, issues, owner) {
  const isArray = typeSpec.endsWith('*');
  const type = isArray ? typeSpec.slice(0, -1) : typeSpec;
  if (type === 'any') return;
  if (isArray !== Array.isArray(value)) { issues.push(`${path}: ${isArray ? 'must be an array' : 'must not be an array'}`); return; }
  const items = isArray ? value : [value];
  items.forEach((item, i) => {
    const p = isArray ? `${path}[${i}]` : path;
    if (TYPES[type]) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) { issues.push(`${p}: must be an object`); return; }
      for (const [k, x] of Object.entries(item)) {
        if (!(k in TYPES[type])) issues.push(`${p}.${k}: unknown element of ${type}`);
        else checkTyped(TYPES[type][k], x, `${p}.${k}`, issues, `${type}.${k}` === 'x' ? type : type);
      }
      if (type === 'Reference' && item.reference === undefined && item.identifier === undefined && item.display === undefined) issues.push(`${p}: Reference needs reference, identifier or display`);
    } else {
      checkPrimitive(type, item, p, issues, owner);
    }
  });
}

/** Issues for ONE resource (strings; empty array = no problems found). */
export function validateResource(resource, path = 'resource') {
  const issues = [];
  if (!resource || typeof resource !== 'object') return [`${path}: must be an object`];
  const def = RESOURCES[resource.resourceType];
  if (!def) return [`${path}: resourceType "${resource.resourceType}" is not covered by this checker`];
  checkNoEmpty(resource, path, issues);
  for (const req of def.required) if (!(req in resource)) issues.push(`${path}.${req}: required element is missing`);
  for (const group of def.requiredOneOf ?? []) if (!group.some((g) => g in resource)) issues.push(`${path}: one of ${group.join(' / ')} is required`);
  if (!('id' in resource) && resource.resourceType !== 'Bundle') issues.push(`${path}.id: missing (every exported resource must carry an id)`);
  for (const [k, v] of Object.entries(resource)) {
    const spec = def.el[k];
    if (!spec) { issues.push(`${path}.${k}: not an element of ${resource.resourceType} in R4`); continue; }
    if (k === 'resourceType') continue;
    checkTyped(spec, v, `${path}.${k}`, issues, `${resource.resourceType}.${k}`);
  }
  if (resource.resourceType === 'Patient') {
    for (const [i, id] of arr(resource.identifier).entries()) if (VALUE_SETS['Identifier.use'] && id.use && !VALUE_SETS['Identifier.use'].includes(id.use)) issues.push(`${path}.identifier[${i}].use: invalid`);
    for (const [i, t] of arr(resource.telecom).entries()) if (t.system && !VALUE_SETS['ContactPoint.system'].includes(t.system)) issues.push(`${path}.telecom[${i}].system: "${t.system}" is not in the required value set`);
    for (const [i, n] of arr(resource.name).entries()) if (n.use && !VALUE_SETS['HumanName.use'].includes(n.use)) issues.push(`${path}.name[${i}].use: invalid`);
  }
  if (resource.resourceType === 'Encounter' && resource.class && resource.class.code === undefined) issues.push(`${path}.class.code: required for our use`);
  return issues;
}

/** Issues for a Bundle and every resource in it, including reference resolution. */
export function validateBundle(bundle) {
  const issues = validateResource({ ...bundle, entry: undefined }, 'Bundle').filter((i) => !i.includes('Bundle.entry'));
  if (bundle.type !== 'collection') issues.push('Bundle.type: this project exports collection bundles only');
  if ('total' in bundle) issues.push('Bundle.total: not allowed for type collection (bdl-1)');
  const entries = bundle.entry ?? [];
  if (!Array.isArray(entries) || entries.length === 0) issues.push('Bundle.entry: a collection export must contain at least one entry');
  const urls = new Set();
  const types = new Map();
  entries.forEach((e, i) => {
    const p = `Bundle.entry[${i}]`;
    if (!e || typeof e !== 'object') { issues.push(`${p}: must be an object`); return; }
    for (const k of Object.keys(e)) if (!['fullUrl', 'resource', 'link', 'search', 'request', 'response', 'extension', 'modifierExtension', 'id'].includes(k)) issues.push(`${p}.${k}: unknown element`);
    if (!e.fullUrl) issues.push(`${p}.fullUrl: required for every entry in our exports`);
    else if (urls.has(e.fullUrl)) issues.push(`${p}.fullUrl: duplicate "${e.fullUrl}" (bdl-7)`);
    else urls.add(e.fullUrl);
    if (!e.resource) { issues.push(`${p}.resource: missing`); return; }
    if (e.fullUrl !== `urn:uuid:${e.resource.id}`) issues.push(`${p}.fullUrl: "${e.fullUrl}" does not match urn:uuid:<resource.id>`);
    types.set(e.fullUrl, e.resource.resourceType);
    issues.push(...validateResource(e.resource, `${p}.resource`));
  });
  entries.forEach((e, i) => {
    const walk = (node, path) => {
      if (Array.isArray(node)) node.forEach((x, j) => walk(x, `${path}[${j}]`));
      else if (node && typeof node === 'object') {
        if (typeof node.reference === 'string') {
          const target = types.get(node.reference);
          if (!target) issues.push(`${path}.reference: "${node.reference}" does not resolve inside the bundle`);
          else {
            const rule = REFERENCE_TARGETS[`${e.resource.resourceType}.${path.split('.').pop()}`];
            if (rule && !rule.includes(target)) issues.push(`${path}.reference: points to a ${target}, allowed: ${rule.join('|')}`);
          }
        }
        for (const [k, x] of Object.entries(node)) walk(x, `${path}.${k}`);
      }
    };
    if (e?.resource) walk(e.resource, `Bundle.entry[${i}].resource`);
  });
  return issues;
}
