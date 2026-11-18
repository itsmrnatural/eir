import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const BAR = '#1d5f8a';
const GRID = '#d3dbe0';
const AXIS = { fontSize: 12, fill: '#41525e' };

/** Horizontal bars: best for long category names (health issues, branches). */
export function HBar({ data, nameKey, valueKey, label }) {
  const height = Math.max(180, data.length * 34 + 48);
  return (
    <div role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" allowDecimals={false} tick={AXIS} />
          <YAxis type="category" dataKey={nameKey} width={120} tick={AXIS} />
          <Tooltip cursor={{ fill: '#eef2f4' }} />
          <Bar dataKey={valueKey} name="Visits" fill={BAR} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bars: best when the x axis is an ordered scale (hours, years). */
export function VBar({ data, nameKey, valueKey, label, interval = 0 }) {
  return (
    <div role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={nameKey} tick={AXIS} interval={interval} />
          <YAxis allowDecimals={false} tick={AXIS} />
          <Tooltip cursor={{ fill: '#eef2f4' }} />
          <Bar dataKey={valueKey} name="Visits" fill={BAR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TimeLine({ data, nameKey, valueKey, label }) {
  return (
    <div role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={nameKey} tick={AXIS} minTickGap={24} />
          <YAxis allowDecimals={false} tick={AXIS} />
          <Tooltip />
          <Line type="monotone" dataKey={valueKey} name="Visits" stroke={BAR} strokeWidth={2} dot={data.length < 32} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
