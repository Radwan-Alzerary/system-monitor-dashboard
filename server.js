// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const si = require('systeminformation');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 8899;

// Serve static files from the public directory
app.use(express.static('public'));

// Socket.IO connection event for system metrics
io.on('connection', (socket) => {
  console.log('New client connected');

  // Send system metrics immediately upon connection
  sendSystemData(socket);

  // Update system metrics every 3 seconds
  const intervalId = setInterval(() => sendSystemData(socket), 3000);

  socket.on('disconnect', () => {
    clearInterval(intervalId);
    console.log('Client disconnected');
  });
});

// Fetch system metrics and emit to the client
async function sendSystemData(socket) {
  try {
    const cpu = await si.currentLoad();
    const mem = await si.mem();
    const disk = await si.fsSize();

    const data = {
      cpu: {
        load: cpu.currentload.toFixed(2) // CPU load percentage
      },
      memory: {
        total: (mem.total / 1024 / 1024).toFixed(2),              // Total memory in MB
        used: ((mem.total - mem.available) / 1024 / 1024).toFixed(2), // Used memory in MB
        free: (mem.available / 1024 / 1024).toFixed(2)              // Free memory in MB
      },
      disk: disk.map(d => ({
        fs: d.fs,
        size: (d.size / 1024 / 1024 / 1024).toFixed(2), // Disk size in GB
        used: (d.used / 1024 / 1024 / 1024).toFixed(2), // Disk used in GB
        use: d.use                                     // Disk usage percentage
      }))
    };

    // Emit the system data to the connected client
    socket.emit('systemData', data);
  } catch (error) {
    console.error('Error fetching system data:', error);
  }
}

// Spawn a child process to run the PM2 logs command in raw mode
const pm2LogProcess = spawn('pm2', ['logs', '--raw']);

// Stream PM2 logs to all connected Socket.IO clients
pm2LogProcess.stdout.on('data', (data) => {
  // Emit the log data to all connected clients
  io.emit('pm2Logs', data.toString());
});

pm2LogProcess.stderr.on('data', (data) => {
  io.emit('pm2Logs', `ERROR: ${data.toString()}`);
});

pm2LogProcess.on('close', (code) => {
  console.log(`PM2 logs process exited with code ${code}`);
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
