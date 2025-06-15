import express from 'express';
import { isMainThread, parentPort } from 'worker_threads';

const app = express();
app.use(express.json());

// In-memory store for registered servers
const registeredServers = new Map();

// Register a new server
app.post('/register', (req, res) => {
  const { id, address, port } = req.body;
  if (!id || !address || !port) {
    return res.status(400).json({ error: 'Missing required fields: id, address, port' });
  }

  registeredServers.set(id, { address, port, lastHeartbeat: Date.now() });
  console.log(`Server registered: ${id} at ${address}:${port}`);
  res.status(200).json({ message: 'Registered successfully' });
});

// Heartbeat from an existing server
app.post('/heartbeat', (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing required field: id' });
  }

  if (registeredServers.has(id)) {
    const server = registeredServers.get(id);
    server.lastHeartbeat = Date.now();
    console.log(`Heartbeat from: ${id}`);
    res.status(200).json({ message: 'Heartbeat received' });
  } else {
    res.status(404).json({ error: 'Server not found' });
  }
});

// Get list of active servers
app.get('/servers', (req, res) => {
  // Prune inactive servers (e.g., no heartbeat for 30 seconds)
  const cutoffTime = Date.now() - 30 * 1000;
  for (const [id, server] of registeredServers.entries()) {
    if (server.lastHeartbeat < cutoffTime) {
      registeredServers.delete(id);
      console.log(`Server unregistered due to inactivity: ${id}`);
    }
  }
  
  const activeServers = Array.from(registeredServers.values());
  res.status(200).json(activeServers);
});

export function startDiscoveryServer(port = process.env.PORT || 3000) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Discovery server listening on port ${port}`);
      resolve(server);
    });
    server.on('error', (err) => {
      reject(err);
    });
  });
}

// If this file is run directly (e.g., as a forked child process),
// start the server.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  (async () => {
    try {
      const server = await startDiscoveryServer();
      // Signal the parent process that the server is ready
      if (process.send) {
        process.send('ready');
      }
    } catch (error) {
      console.error('Failed to start discovery server in forked process:', error);
      process.exit(1); // Exit with error code
    }
  })();
} 