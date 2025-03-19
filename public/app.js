// Find this function in your existing app.js file and replace it with this version

function initializeSocketConnection() {
    // Connect to the server using the current URL origin
    console.log("Connecting to server at:", window.location.origin);
    socket = io(window.location.origin, {
        query: {
            username: state.username,
            role: state.userRole
        },
        reconnectionAttempts: 5,
        timeout: 10000
    });
    
    // Socket event handlers
    socket.on('connect', () => {
        state.isConnected = true;
        console.log('Connected to server with socket ID:', socket.id);
        
        // Initialize the voice handler
        voiceHandler = new VoiceHandler(socket);
        
        // Update user counts
        updateChannelCounts();
        
        showNotification('Connected to server', 'success');
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        showNotification('Error connecting to server: ' + error.message, 'error');
    });
    
    socket.on('disconnect', () => {
        state.isConnected = false;
        console.log('Disconnected from server');
        showNotification('Disconnected from server', 'error');
        
        // Clean up
        if (state.currentChannel) {
            leaveCurrentChannel(true);
        }
    });
    
    socket.on('channelCounts', updateChannelUserCounts);
    
    socket.on('userJoined', (data) => {
        showNotification(`${data.username} joined the channel`);
        updateParticipantsList(data.participants);
    });
    
    socket.on('userLeft', (data) => {
        showNotification(`${data.username} left the channel`);
        updateParticipantsList(data.participants);
    });
    
    socket.on('userMuted', (data) => {
        state.participants[data.userId].isMuted = true;
        updateParticipantsList(state.participants);
        
        if (data.userId === socket.id) {
            state.isMuted = true;
            updateMicButtonState();
            showNotification('You were muted by a moderator');
        }
    });
    
    socket.on('userUnmuted', (data) => {
        state.participants[data.userId].isMuted = false;
        updateParticipantsList(state.participants);
        
        if (data.userId === socket.id) {
            state.isMuted = false;
            updateMicButtonState();
            showNotification('You were unmuted by a moderator');
        }
    });
    
    socket.on('emojiReaction', (data) => {
        displayEmojiAnimation(data.emoji, data.username);
    });
    
    socket.on('error', (error) => {
        console.error('Socket error:', error);
        showNotification(error, 'error');
    });
}