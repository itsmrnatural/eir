/** Native radio group styled as a segmented control, so arrow keys and screen readers work for free. */
export default function Segmented({ name, legend, value, onChange, options }) {
  return (
    <fieldset className="segmented">
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={value === o.value ? 'on' : ''}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
