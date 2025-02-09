// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const si = require('systeminformation');
const { spawn } = require('child_process');

// Create an Express app
const app = express();

// Define the port (8899 in this example)
const PORT = process.env.PORT || 8899;

// Create an HTTP server using the Express app
const server = http.createServer(app);

// Optionally, serve static files (e.g., your HTML/JS client) from the "public" folder
app.use(express.static('public'));

// Create a WebSocket server attached to the HTTP server
const wss = new WebSocket.Server({ server });

// Helper function: Broadcast data to all connected clients
function broadcast(data) {
  const jsonData = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonData);
    }
  });
}

// Function to fetch and broadcast system metrics
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
          used: (d.used / 1024 / 1024 / 1024).toFixed(2), // Disk used in GB
          use: d.use                                     // Disk usage percentage
        }))
      }
    };

    // Broadcast the system data to all clients
    broadcast(systemData);
  } catch (error) {
    console.error('Error fetching system data:', error);
  }
}

// Set up an interval to send system metrics every 3 seconds
setInterval(sendSystemData, 3000);

// Spawn a child process to run the PM2 logs command in raw mode
const pm2LogProcess = spawn('pm2', ['logs', '--raw']);

// Listen for data from PM2 stdout and broadcast it to clients
pm2LogProcess.stdout.on('data', data => {
  broadcast({ type: 'pm2Logs', payload: data.toString() });
});

// Listen for any errors from PM2 logs and broadcast the error output
pm2LogProcess.stderr.on('data', data => {
  broadcast({ type: 'pm2Logs', payload: "ERROR: " + data.toString() });
});

// Log when the PM2 logs process closes
pm2LogProcess.on('close', code => {
  console.log(`PM2 logs process exited with code ${code}`);
});

// Handle new WebSocket client connections
wss.on('connection', ws => {
  console.log('New client connected');

  // Optionally send immediate system data upon connection
  sendSystemData();

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Start the HTTP & WebSocket server
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
