import Field from '../../components/Field.jsx';

export const OTHER = '__other__';

/** Turns the dropdown/free-text state into the API fields. */
export function resolveIssue(selected, custom) {
  return selected === OTHER
    ? { health_issue: custom.trim(), health_issue_is_custom: true }
    : { health_issue: selected, health_issue_is_custom: false };
}

/**
 * Dropdown of health issues (from /meta/health-issues) plus "Other…" which reveals a free-text box.
 * `issues` is [{code,label}]; the visit stores the label (see ASSUMPTIONS A3).
 */
export default function HealthIssueField({ issues, value, onChange, custom, onCustomChange, selectRef, customRef, issueError, customError }) {
  // Keep a value that is not in the list selectable (e.g. an old label), so editing never blanks it.
  const known = !value || value === OTHER || issues.some((i) => i.label === value);
  return (
    <>
      <Field label="Health issue" error={issueError}>
        <select ref={selectRef} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select a health issue</option>
          {!known && <option value={value}>{value}</option>}
          {issues.map((i) => (
            <option key={i.code} value={i.label}>{i.label}</option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
      </Field>
      {value === OTHER && (
        <Field label="Describe the issue" error={customError}>
          <input ref={customRef} value={custom} onChange={(e) => onCustomChange(e.target.value)} maxLength={120} autoComplete="off" />
        </Field>
      )}
    </>
  );
}
