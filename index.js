import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import basicAuth from 'express-basic-auth';
import dotenv from 'dotenv';
import { io as ioClient } from 'socket.io-client';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import routes from './routes.js';
import { initializeSocketHandlers, handleSubathonAddTime } from './socketHandlers.js';
import { initializeEventSub } from './eventSub.js';
import { initializeBotCommands } from './botCommands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
global.app = app; // Make app available globally for EventSub
const port = 3000;
const server = http.createServer(app);
const io = new Server(server);
let eventSubClient;
let streamlabsSocket;

// Initialize Streamlabs Socket
if (process.env.streamlabs_socket_token) {
  streamlabsSocket = ioClient(`https://sockets.streamlabs.com?token=${process.env.streamlabs_socket_token}`, {
    transports: ['websocket']
  });

  streamlabsSocket.on('connect', () => {
    console.log('Connected to Streamlabs websocket');
  });

  streamlabsSocket.on('event', async (eventData) => {
    if (eventData.type === 'donation') {
      const amount = parseFloat(eventData.message[0].amount);
      if (!isNaN(amount)) {
        // Add 1 minute per dollar
        const minutes = Math.floor(amount);
        if (minutes > 0) {
          const socketHandlers = app.get('socketHandlers');
          if (socketHandlers && socketHandlers.handleSubathonAddTime) {
            await socketHandlers.handleSubathonAddTime(minutes * 60, `donation_$${amount}`, io);
          } else {
            console.error('Socket handlers not found for Streamlabs donation');
          }
        }
      }
    }
  });

  streamlabsSocket.on('disconnect', () => {
    console.log('Disconnected from Streamlabs websocket');
  });
}

// Make io available to routes
app.set('io', io);

app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d" }));
app.set("view engine", "ejs");

// Initialize Routes
app.use("/", routes);

// Basic Auth Middleware
app.use(
  basicAuth({
    users: { [process.env.web_user]: process.env.web_pass },
    challenge: true,
  })
);

// Initialize Socket Handlers
// Store socket handlers for use by other parts of the app
app.set('socketHandlers', { handleSubathonAddTime });
initializeSocketHandlers(io);

// Initialize EventSub and Bot
async function initialize() {
  // Verify required EventSub environment variables
  const requiredEnvVars = {
    development: ['EVENTSUB_CLIENT_ID', 'EVENTSUB_CLIENT_SECRET', 'TEST_CHANNEL_ID'],
    production: ['EVENTSUB_CLIENT_ID', 'EVENTSUB_CLIENT_SECRET', 'TWITCH_CHANNEL_ID']
  };

  const currentEnv = process.env.NODE_ENV || 'production';
  const missingVars = requiredEnvVars[currentEnv].filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error(`Missing required environment variables for ${currentEnv} mode:`, missingVars);
    console.error('EventSub initialization skipped');
  } else {
    try {
      eventSubClient = await initializeEventSub(io);
      if (eventSubClient && eventSubClient.needsAuth) {
        console.log('Twitch authentication required. Please visit https://leantube.org/auth/ to authenticate.');
      } else if (eventSubClient) {
        console.log('EventSub initialized successfully');
        // Store the client in the app
        app.set('eventSubClient', eventSubClient);
      }
    } catch (error) {
      console.error('Failed to initialize EventSub:', error);
    }
  }

  // Ensure bot is connected
  initializeBotCommands(io);
}

// Start server and initialize services
server.listen(port, () => {
  console.log(`Listening on *:${port}`);
  initialize().catch(error => {
    console.error('Failed to initialize services:', error);
  });
});

// Handle process termination
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (eventSubClient) {
    await eventSubClient.stop();
  }
  if (streamlabsSocket) {
    streamlabsSocket.disconnect();
  }
  process.exit(0);
});
