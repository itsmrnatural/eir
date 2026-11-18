import { runConformance } from './conformance.js';
import { createInMemoryRepositories } from '../index.js';

function makeClock(start = new Date()) {
  let t = start;
  return { now: () => t, set: (d) => { t = new Date(d); } };
}

runConformance('in-memory', async () => {
  const clock = makeClock();
  const repos = createInMemoryRepositories({ clock: () => clock.now(), duplicateWindowMin: 10 });
  const s = repos._state;
  return {
    repos,
    clock,
    deactivateRfid: async (id) => { s.rfids.get(id).is_active = false; },
    audit: async (entity, id) => s.audit.filter((a) => a.entity === entity && a.entity_id === id),
  };
});
