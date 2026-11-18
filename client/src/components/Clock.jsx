import { useEffect, useState } from 'react';
import { formatDateTime } from '../lib/datetime.js';

/** Current date and time in Asia/Kolkata. */
export default function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  return <time dateTime={now.toISOString()}>{formatDateTime(now)}</time>;
}
