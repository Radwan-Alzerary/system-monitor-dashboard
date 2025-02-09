// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const si = require('systeminformation');
const { spawn, exec } = require('child_process');

// Create an Express app and HTTP server
const app = express();
const PORT = process.env.PORT || 8899;
const server = http.createServer(app);

// Serve static files from the "public" folder (your client HTML, etc.)
app.use(express.static('public'));

// Create a WebSocket server on top of the HTTP server
const wss = new WebSocket.Server({ server });

/**
 * Broadcast a JSON message to all connected WebSocket clients.
 * @param {Object} data - The data object to send.
 */
function broadcast(data) {
  const jsonData = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonData);
    }
  });
}

/**
 * Fetch and broadcast system metrics (CPU, Memory, Disk usage).
 */
async function sendSystemData() {
  try {
    const cpu = await si.currentLoad();
    const mem = await si.mem();
    const disk = await si.fsSize();

    const systemData = {
      type: 'systemData',
      payload: {
        cpu: {
          load: cpu.currentload.toFixed(2) // CPU load percentage
        },
        memory: {
          total: (mem.total / 1024 / 1024).toFixed(2),       // Total memory in MB
          used: ((mem.total - mem.available) / 1024 / 1024).toFixed(2), // Used memory in MB
          free: (mem.available / 1024 / 1024).toFixed(2)       // Free memory in MB
        },
        disk: disk.map(d => ({
          fs: d.fs,
          size: (d.size / 1024 / 1024 / 1024).toFixed(2), // Disk size in GB
          used: (d.used / 1024 / 1024 / 1024).toFixed(2),   // Disk used in GB
          use: d.use                                       // Disk usage percentage
        }))
      }
    };

    broadcast(systemData);
  } catch (error) {
    console.error('Error fetching system data:', error);
  }
}

// Broadcast system metrics every 3 seconds
setInterval(sendSystemData, 3000);

/**
 * Get the list of PM2 processes (projects) using `pm2 jlist`,
 * then broadcast the list of unique process names.
 */
function updateProjectList() {
  exec('pm2 jlist', (err, stdout, stderr) => {
    if (err) {
      console.error('Error fetching PM2 project list:', err);
      return;
    }
    try {
      const processList = JSON.parse(stdout);
      // Extract unique project names (assumes each PM2 process has a 'name' property)
      const projects = [...new Set(processList.map(proc => proc.name))];
      broadcast({ type: 'projectList', payload: projects });
    } catch (error) {
      console.error('Error parsing PM2 project list:', error);
    }
  });
}

// Update the project list every 10 seconds (and immediately on startup)
setInterval(updateProjectList, 10000);
updateProjectList();

/**
 * Spawn a PM2 logs process in raw mode and broadcast each log line.
 */
const pm2LogProcess = spawn('pm2', ['logs', '--raw']);

pm2LogProcess.stdout.on('data', data => {
  // Data may include multiple lines; split them and broadcast each non-empty line.
  const lines = data.toString().split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      broadcast({ type: 'pm2Logs', payload: line });
    }
  });
});

pm2LogProcess.stderr.on('data', data => {
  broadcast({ type: 'pm2Logs', payload: "ERROR: " + data.toString() });
});

pm2LogProcess.on('close', code => {
  console.log(`PM2 logs process exited with code ${code}`);
});

// Log new WebSocket connections and send an immediate update if desired.
wss.on('connection', ws => {
  console.log('New client connected');
  sendSystemData();
  updateProjectList();

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Start the HTTP and WebSocket server
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
