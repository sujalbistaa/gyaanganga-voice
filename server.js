const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');

// Create Express app and server
const app = express();
const server = http.createServer(app);

// Set up Socket.io with CORS enabled
const io = socketIO(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Enable CORS for Express
app.use(cors());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Voice channels configuration
const channels = {
    'class-8': { name: 'Class 8', participants: {}, maxParticipants: 30 },
    'class-9': { name: 'Class 9', participants: {}, maxParticipants: 30 },
    'class-10': { name: 'Class 10', participants: {}, maxParticipants: 30 },
    'class-11': { name: 'Class 11', participants: {}, maxParticipants: 30 },
    'class-12': { name: 'Class 12', participants: {}, maxParticipants: 30 },
    'entrance-prep': { name: 'Entrance Prep', participants: {}, maxParticipants: 50 }
};

// Connected users storage
const users = {};
const inactivityTimeout = 10 * 60 * 1000; // 10 minutes

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);
    
    // Get user info from query params
    const username = socket.handshake.query.username || 'Anonymous';
    const role = socket.handshake.query.role || 'student';
    
    // Generate random avatar
    const avatarSeed = Math.floor(Math.random() * 1000);
    const avatarUrl = `https://avatars.dicebear.com/api/adventurer/${avatarSeed}.svg`;
    
    // Store user info
    users[socket.id] = {
        id: socket.id,
        username,
        role,
        avatarUrl,
        channelId: null,
        lastActivity: Date.now(),
        isMuted: true,
        isSpeaking: false
    };
    
    // Send channel counts to the new user
    socket.emit('channelCounts', getChannelCounts());
    
    // Join channel request
    socket.on('joinChannel', (data, callback) => {
        const { channelId } = data;
        const user = users[socket.id];
        
        // Check if channel exists
        if (!channels[channelId]) {
            return callback({ success: false, error: 'Channel does not exist' });
        }
        
        // Check if channel is full
        if (Object.keys(channels[channelId].participants).length >= channels[channelId].maxParticipants) {
            return callback({ success: false, error: 'Channel is full' });
        }
        
        // Leave current channel if in one
        if (user.channelId) {
            leaveChannel(socket, user.channelId);
        }
        
        // Join new channel
        user.channelId = channelId;
        user.lastActivity = Date.now();
        
        // Add user to channel participants
        channels[channelId].participants[socket.id] = {
            id: socket.id,
            username: user.username,
            role: user.role,
            avatarUrl: user.avatarUrl,
            isMuted: user.isMuted,
            isSpeaking: user.isSpeaking
        };
        
        // Join the socket.io room
        socket.join(channelId);
        
        // Notify other users in the channel
        socket.to(channelId).emit('userJoined', {
            username: user.username,
            participants: channels[channelId].participants
        });
        
        // Broadcast updated channel counts
        io.emit('channelCounts', getChannelCounts());
        
        // Send success response with participants list
        callback({
            success: true,
            participants: channels[channelId].participants
        });
    });
    
    // Leave channel request
    socket.on('leaveChannel', (data) => {
        const { channelId } = data;
        leaveChannel(socket, channelId);
    });
    
    // Get channel counts
    socket.on('getChannelCounts', (data, callback) => {
        callback({
            success: true,
            counts: getChannelCounts()
        });
    });
    
    // Update mute status
    socket.on('updateMuteStatus', (data) => {
        const { channelId, isMuted } = data;
        const user = users[socket.id];
        
        if (user && user.channelId === channelId) {
            user.isMuted = isMuted;
            user.lastActivity = Date.now();
            
            // Update in channel participants
            if (channels[channelId] && channels[channelId].participants[socket.id]) {
                channels[channelId].participants[socket.id].isMuted = isMuted;
                
                // Notify all users in the channel
                io.to(channelId).emit('userJoined', {
                    username: user.username,
                    participants: channels[channelId].participants
                });
            }
        }
    });
    
    // WebRTC Signaling: Ready for voice
    socket.on('readyForVoice', (data, callback) => {
        const { channelId } = data;
        const user = users[socket.id];
        
        if (user && user.channelId === channelId) {
            user.lastActivity = Date.now();
            
            // Get peers (other users in the channel)
            const peers = Object.keys(channels[channelId].participants).filter(id => id !== socket.id);
            
            // Notify other users that a new peer is ready
            socket.to(channelId).emit('newUserJoined', {
                userId: socket.id
            });
            
            callback({
                success: true,
                peers: peers
            });
        } else {
            callback({
                success: false,
                error: 'Not in channel'
            });
        }
    });
    
    // WebRTC Signaling: Offer
    socket.on('offer', (data) => {
        const { to, offer } = data;
        const user = users[socket.id];
        
        if (user) {
            user.lastActivity = Date.now();
            
            // Forward the offer to the target peer
            io.to(to).emit('offer', {
                from: socket.id,
                offer: offer
            });
        }
    });
    
    // WebRTC Signaling: Answer
    socket.on('answer', (data) => {
        const { to, answer } = data;
        const user = users[socket.id];
        
        if (user) {
            user.lastActivity = Date.now();
            
            // Forward the answer to the target peer
            io.to(to).emit('answer', {
                from: socket.id,
                answer: answer
            });
        }
    });
    
    // WebRTC Signaling: ICE Candidate
    socket.on('iceCandidate', (data) => {
        const { to, candidate } = data;
        const user = users[socket.id];
        
        if (user) {
            user.lastActivity = Date.now();
            
            // Forward the ICE candidate to the target peer
            io.to(to).emit('iceCandidate', {
                from: socket.id,
                candidate: candidate
            });
        }
    });
    
    // Disconnection handling
    socket.on('disconnect', () => {
        console.log(`Disconnected: ${socket.id}`);
        
        const user = users[socket.id];
        
        if (user) {
            // Leave current channel if in one
            if (user.channelId) {
                leaveChannel(socket, user.channelId);
            }
            
            // Remove user from users list
            delete users[socket.id];
        }
    });
});

// Helper function to handle leaving a channel
function leaveChannel(socket, channelId) {
    const user = users[socket.id];
    
    if (!user || !channels[channelId]) return;
    
    // Remove user from channel participants
    if (channels[channelId].participants[socket.id]) {
        delete channels[channelId].participants[socket.id];
        
        // Leave the socket.io room
        socket.leave(channelId);
        
        // Update user's channel ID
        user.channelId = null;
        
        // Notify other users in the channel
        socket.to(channelId).emit('userLeft', {
            username: user.username,
            participants: channels[channelId].participants
        });
        
        // Notify other users that a peer has disconnected
        socket.to(channelId).emit('userDisconnected', {
            userId: socket.id
        });
        
        // Broadcast updated channel counts
        io.emit('channelCounts', getChannelCounts());
    }
}

// Helper function to get channel user counts
function getChannelCounts() {
    const counts = {};
    
    Object.keys(channels).forEach(channelId => {
        counts[channelId] = Object.keys(channels[channelId].participants).length;
    });
    
    return counts;
}

// Default route - serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all route to handle direct URL access for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});