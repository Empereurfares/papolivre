const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); // Enable CORS

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for now, you can restrict this to your frontend domain
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 3000;

const usersInRooms = {}; // Object to keep track of users in each room
const userSockets = {}; // Map usernames to their socket IDs

// Serve a simple message at the root URL for testing
app.get('/', (req, res) => {
  res.send('Backend server is running');
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

io.on('connection', (socket) => {
  let joinedUser;
  let joinedRoom;
  console.log('a user connected');

  socket.on('checkUsername', (data) => {
    const { roomName, username } = data;
    const isTaken = usersInRooms[roomName]?.has(username) || username === 'Todos';
    socket.emit('usernameCheckResult', isTaken);
  });

  socket.on('join', (data) => {
    const { roomName, username } = data;
    joinedRoom = roomName; // Store the room name
    joinedUser = username;  // Store the username

    socket.join(roomName);

    if (!usersInRooms[roomName]) {
      usersInRooms[roomName] = new Set();
    }
    usersInRooms[roomName].add(username);
    userSockets[username] = socket.id; // Map the username to the socket ID

    io.to(roomName).emit('roomUsers', Array.from(usersInRooms[joinedRoom]));

    console.log(`User ${username} joined room: ${roomName}`);
  });

  socket.on('message', (data) => {
    if (data.type === 'image') {
      // Handling image messages
      const imageMessage = {
        sender: data.sender,
        image: data.text, // Assuming data.text contains the base64 image string
      };

      if (data.target === 'for all') {
        io.to(data.room).emit('imageMessage', imageMessage);
      } else if (data.isPublic) {
        // Public image message directed to a specific user
        io.to(data.room).emit('imageMessage', {
          ...imageMessage,
          target: data.target,
        });
      } else {
        // Private image message
        socket.to(userSockets[data.target]).emit('imageMessage', imageMessage);
        socket.emit('imageMessage', {
          ...imageMessage,
          target: data.target,
        });
      }
    } else {
      // Handling text messages as before
      if (data.target === 'for all') {
        const messageToSend = `${data.sender}: ${data.text}`;
        io.to(data.room).emit('message', messageToSend);
      } else if (data.isPublic) {
        // Public message directed to a specific user
        const publicMessage = `${data.sender} in public talks to ${data.target}: ${data.text}`;
        io.to(data.room).emit('message', publicMessage);
      } else {
        // Private message
        const privateMessageToSend = `${data.sender} (private): ${data.text}`;
        socket.to(userSockets[data.target]).emit('message', privateMessageToSend);
        socket.emit('message', `You (private to ${data.target}): ${data.text}`);
      }
    }
  });

  socket.on('webrtc_offer', (data) => {
    socket.to(userSockets[data.target]).emit('webrtc_offer', {
      sender: socket.id,
      sdp: data.sdp
    });
  });

  socket.on('webrtc_answer', (data) => {
    socket.to(userSockets[data.target]).emit('webrtc_answer', {
      sender: socket.id,
      sdp: data.sdp
    });
  });

  socket.on('invite-to-call', (data) => {
    // Notify the selected user
    const targetSocketId = userSockets[data.to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-invitation', {
        from: data.from,
        roomName: data.roomName,
      });
    }
  });

  socket.on('webrtc_ice_candidate', (data) => {
    socket.to(userSockets[data.target]).emit('webrtc_ice_candidate', {
      sender: socket.id,
      candidate: data.candidate
    });
  });

  socket.on('disconnect', () => {
    if (joinedRoom && usersInRooms[joinedRoom]) {
      usersInRooms[joinedRoom].delete(joinedUser);
      if (usersInRooms[joinedRoom].size === 0) {
        delete usersInRooms[joinedRoom];
      } else {
        io.to(joinedRoom).emit('roomUsers', Array.from(usersInRooms[joinedRoom]));
      }
    }
    delete userSockets[joinedUser]; // Remove from userSockets mapping
    console.log(`User ${joinedUser} disconnected from room: ${joinedRoom}`);
  });
});
