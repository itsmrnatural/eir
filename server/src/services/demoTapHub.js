/**
 * Demo only. In-memory fan-out of "card tapped" events from a phone to the open app screens.
 *
 * A phone (Web NFC page) POSTs a card id; every browser that holds an open Server-Sent-Events
 * stream receives it and runs the normal student lookup, exactly as if a USB reader had typed it.
 * Nothing is stored: no database, no log of card ids, no history. Restarting the server clears it.
 */

const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_MAX_CLIENTS = 20;

export function createDemoTapHub({ heartbeatMs = DEFAULT_HEARTBEAT_MS, maxClients = DEFAULT_MAX_CLIENTS } = {}) {
  /** @type {Map<number, {res: import('http').ServerResponse, timer: NodeJS.Timeout}>} */
  const clients = new Map();
  let nextId = 1;

  const write = (res, chunk) => {
    try {
      res.write(chunk);
      return true;
    } catch {
      return false; // socket already gone; its 'close' handler cleans up
    }
  };
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  function drop(id) {
    const c = clients.get(id);
    if (!c) return;
    clearInterval(c.timer);
    clients.delete(id);
  }

  return {
    get size() {
      return clients.size;
    },

    /** Turns `res` into an SSE stream. Returns false (and writes nothing) when the hub is full. */
    subscribe(req, res) {
      if (clients.size >= maxClients) return false;
      const id = nextId++;

      res.status(200);
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // tell reverse proxies not to buffer the stream
      });
      res.flushHeaders();
      write(res, 'retry: 2000\n\n'); // browser reconnect delay
      write(res, frame('hello', { listeners: clients.size + 1 }));

      // Comment lines keep idle connections (and Wi-Fi power saving) from dropping the stream.
      const timer = setInterval(() => write(res, ': ping\n\n'), heartbeatMs);
      timer.unref();
      clients.set(id, { res, timer });
      req.on('close', () => drop(id));
      return true;
    },

    /** Sends a tap to every listening screen. Returns how many screens it reached. */
    publish(rfid_id) {
      const payload = { rfid_id, at: new Date().toISOString() };
      let delivered = 0;
      for (const [id, c] of clients) {
        if (write(c.res, frame('tap', payload))) delivered += 1;
        else drop(id);
      }
      return delivered;
    },

    /** Ends every stream (graceful shutdown would otherwise wait on them until the force timeout). */
    closeAll() {
      for (const [id, c] of clients) {
        try {
          c.res.end();
        } catch {
          /* already closed */
        }
        drop(id);
      }
    },
  };
}
