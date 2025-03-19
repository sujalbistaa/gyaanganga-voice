// Main application logic
document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const welcomeScreen = document.getElementById('welcome-screen');
    const channelView = document.getElementById('channel-view');
    const loginButton = document.getElementById('login-button');
    const usernameInput = document.getElementById('username-input');
    const userRoleSelect = document.getElementById('user-role');
    const userAvatarImg = document.getElementById('user-avatar-img');
    const usernameDisplay = document.getElementById('username');
    const userStatusDisplay = document.getElementById('user-status');
    const channelElements = document.querySelectorAll('.channel');
    const currentChannelName = document.getElementById('current-channel-name');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const participantsList = document.getElementById('participants-list');
    const toggleNoiseSuppression = document.getElementById('toggle-noise-suppression');
    const togglePushToTalk = document.getElementById('toggle-push-to-talk');
    const micButton = document.getElementById('mic-button');
    const volumeSlider = document.getElementById('volume-slider');
    const emojiReactions = document.querySelectorAll('.emoji-reaction');
    const startTimer = document.getElementById('start-timer');
    const resetTimer = document.getElementById('reset-timer');
    const timerMinutes = document.getElementById('timer-minutes');
    const timerSeconds = document.getElementById('timer-seconds');
    const notificationsContainer = document.getElementById('notifications');

    // Application state
    const state = {
        username: '',
        userRole: 'student',
        currentChannel: null,
        isConnected: false,
        isMuted: true,
        isPushToTalk: false,
        isNoiseSuppressionEnabled: false,
        participants: {},
        timerInterval: null,
        timerRunning: false,
        timerValue: 25 * 60, // 25 minutes in seconds
        lastActivity: Date.now(),
        inactivityTimeout: 10 * 60 * 1000, // 10 minutes
    };

    // Socket.io connection (will be initialized when user logs in)
    let socket = null;
    
    // Voice handler (will be initialized when user logs in)
    let voiceHandler = null;

    // Initialize the application
    function init() {
        setupEventListeners();
        checkForInactivity();
        generateRandomAvatar();
        document.addEventListener('mousemove', updateActivity);
        document.addEventListener('keydown', updateActivity);
    }

    // Set up event listeners
    function setupEventListeners() {
        // Login button
        loginButton.addEventListener('click', handleLogin);
        
        // Channel selection
        channelElements.forEach(channel => {
            channel.addEventListener('click', () => {
                if (!state.isConnected) {
                    showNotification('Please login first', 'error');
                    return;
                }
                
                const channelId = channel.getAttribute('data-channel');
                joinChannel(channelId);
            });
        });
        
        // Disconnect button
        disconnectBtn.addEventListener('click', leaveCurrentChannel);
        
        // Toggle noise suppression
        toggleNoiseSuppression.addEventListener('click', () => {
            state.isNoiseSuppressionEnabled = !state.isNoiseSuppressionEnabled;
            toggleNoiseSuppression.classList.toggle('active', state.isNoiseSuppressionEnabled);
            
            if (voiceHandler) {
                voiceHandler.toggleNoiseSuppression(state.isNoiseSuppressionEnabled);
            }
            
            showNotification(`Noise suppression ${state.isNoiseSuppressionEnabled ? 'enabled' : 'disabled'}`);
        });
        
        // Toggle push to talk
        togglePushToTalk.addEventListener('click', () => {
            state.isPushToTalk = !state.isPushToTalk;
            togglePushToTalk.classList.toggle('active', state.isPushToTalk);
            
            if (state.isPushToTalk) {
                document.addEventListener('keydown', handlePushToTalkKeyDown);
                document.addEventListener('keyup', handlePushToTalkKeyUp);
                state.isMuted = true;
                updateMicButtonState();
            } else {
                document.removeEventListener('keydown', handlePushToTalkKeyDown);
                document.removeEventListener('keyup', handlePushToTalkKeyUp);
            }
            
            showNotification(`Push to talk ${state.isPushToTalk ? 'enabled' : 'disabled'}`);
        });
        
        // Mic button
        micButton.addEventListener('click', toggleMic);
        
        // Volume slider
        volumeSlider.addEventListener('input', (e) => {
            if (voiceHandler) {
                voiceHandler.setVolume(e.target.value / 100);
            }
        });
        
        // Emoji reactions
        emojiReactions.forEach(reaction => {
            reaction.addEventListener('click', () => {
                const emoji = reaction.getAttribute('data-emoji');
                sendEmojiReaction(emoji);
            });
        });
        
        // Pomodoro timer controls
        startTimer.addEventListener('click', toggleTimer);
        resetTimer.addEventListener('click', resetPomodoroClock);
    }
    
    // Handle user login
    function handleLogin() {
        const username = usernameInput.value.trim();
        const userRole = userRoleSelect.value;
        
        if (!username) {
            showNotification('Please enter your name', 'error');
            return;
        }
        
        // Save user info to state
        state.username = username;
        state.userRole = userRole;
        
        // Update UI
        usernameDisplay.textContent = username;
        userStatusDisplay.textContent = 'Online';
        
        // Initialize socket connection
        initializeSocketConnection();
        
        // Hide welcome screen, show channel view
        welcomeScreen.classList.add('hidden');
        channelView.classList.remove('hidden');
        micButton.classList.remove('hidden');
        
        showNotification(`Welcome, ${username}!`, 'success');
    }
    
    // Initialize Socket.io connection
    function initializeSocketConnection() {
// Connect to the server
socket = io('http://localhost:3000', {
    query: {
        username: state.username,
        role: state.userRole
    }
});
        
        // Socket event handlers
        socket.on('connect', () => {
            state.isConnected = true;
            console.log('Connected to server');
            
            // Initialize the voice handler
            voiceHandler = new VoiceHandler(socket);
            
            // Update user counts
            updateChannelCounts();
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
            showNotification(error, 'error');
        });
    }
    
    // Join a voice channel
    function joinChannel(channelId) {
        if (state.currentChannel === channelId) return;
        
        // Leave current channel first if in one
        if (state.currentChannel) {
            leaveCurrentChannel();
        }
        
        // Join new channel
        socket.emit('joinChannel', { channelId }, (response) => {
            if (response.success) {
                state.currentChannel = channelId;
                updateChannelUI(channelId);
                updateParticipantsList(response.participants);
                
                // Initialize voice connection for this channel
                voiceHandler.joinVoiceChannel(channelId);
                
                showNotification(`Joined channel: ${getChannelDisplayName(channelId)}`, 'success');
            } else {
                showNotification(response.error, 'error');
            }
        });
    }
    
    // Leave the current voice channel
    function leaveCurrentChannel(isDisconnect = false) {
        if (!state.currentChannel) return;
        
        if (!isDisconnect) {
            socket.emit('leaveChannel', { channelId: state.currentChannel });
        }
        
        // Clean up voice connection
        if (voiceHandler) {
            voiceHandler.leaveVoiceChannel();
        }
        
        // Update UI
        const previousChannel = document.querySelector(`.channel[data-channel="${state.currentChannel}"]`);
        if (previousChannel) {
            previousChannel.classList.remove('active');
        }
        
        state.currentChannel = null;
        currentChannelName.textContent = 'Not Connected';
        participantsList.innerHTML = '';
        
        showNotification('Left voice channel', isDisconnect ? 'error' : 'info');
    }
    
    // Update the UI when changing channels
    function updateChannelUI(channelId) {
        // Update the channel list (highlight active channel)
        channelElements.forEach(channel => {
            channel.classList.remove('active');
            if (channel.getAttribute('data-channel') === channelId) {
                channel.classList.add('active');
            }
        });
        
        // Update current channel display
        currentChannelName.textContent = getChannelDisplayName(channelId);
    }
    
    // Update the list of participants in the channel
    function updateParticipantsList(participants) {
        state.participants = participants;
        participantsList.innerHTML = '';
        
        Object.values(participants).forEach(participant => {
            const participantEl = document.createElement('div');
            participantEl.className = 'participant';
            participantEl.id = `participant-${participant.id}`;
            
            if (participant.isSpeaking) {
                participantEl.classList.add('speaking');
            }
            
            participantEl.innerHTML = `
                <div class="participant-avatar">
                    <img src="${participant.avatarUrl || 'https://via.placeholder.com/36'}" alt="${participant.username}">
                    <div class="speaking-indicator"></div>
                </div>
                <div class="participant-info">
                    <div class="participant-name">
                        ${participant.username}
                        ${participant.role === 'teacher' ? '<span class="teacher-badge">Teacher</span>' : ''}
                    </div>
                    <div class="participant-role">${participant.isMuted ? 'Muted' : 'Speaking'}</div>
                </div>
                ${state.userRole === 'teacher' && participant.id !== socket.id ? `
                <div class="participant-controls">
                    <button class="mute-btn" data-id="${participant.id}" title="${participant.isMuted ? 'Unmute' : 'Mute'}">
                        <i class="fa-solid ${participant.isMuted ? 'fa-microphone' : 'fa-microphone-slash'}"></i>
                    </button>
                </div>
                ` : ''}
            `;
            
            participantsList.appendChild(participantEl);
        });
        
        // Add event listeners for mute/unmute buttons (teacher only)
        if (state.userRole === 'teacher') {
            document.querySelectorAll('.mute-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const userId = btn.getAttribute('data-id');
                    const isMuted = state.participants[userId].isMuted;
                    
                    socket.emit(isMuted ? 'unmuteUser' : 'muteUser', { userId });
                });
            });
        }
    }
    
    // Update the user counts for all channels
    function updateChannelCounts() {
        socket.emit('getChannelCounts', {}, (response) => {
            if (response.success) {
                updateChannelUserCounts(response.counts);
            }
        });
    }
    
    // Update the user count displays
    function updateChannelUserCounts(counts) {
        Object.entries(counts).forEach(([channelId, count]) => {
            const channel = document.querySelector(`.channel[data-channel="${channelId}"]`);
            if (channel) {
                const countElement = channel.querySelector('.user-count');
                if (countElement) {
                    countElement.textContent = count;
                }
            }
        });
    }
    
    // Toggle microphone mute state
    function toggleMic() {
        if (state.isPushToTalk) {
            showNotification('Cannot toggle mic while Push to Talk is active', 'info');
            return;
        }
        
        state.isMuted = !state.isMuted;
        
        if (voiceHandler) {
            voiceHandler.setMicMuted(state.isMuted);
        }
        
        updateMicButtonState();
        
        if (state.currentChannel) {
            socket.emit('updateMuteStatus', { 
                channelId: state.currentChannel, 
                isMuted: state.isMuted 
            });
        }
    }
    
    // Update the mic button appearance based on mute state
    function updateMicButtonState() {
        if (state.isMuted) {
            micButton.classList.remove('active');
            micButton.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
        } else {
            micButton.classList.add('active');
            micButton.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        }
    }
    
    // Handle push-to-talk key down (Space bar)
    function handlePushToTalkKeyDown(e) {
        if (e.code === 'Space' && state.isPushToTalk && state.isMuted) {
            e.preventDefault(); // Prevent scrolling
            state.isMuted = false;
            
            if (voiceHandler) {
                voiceHandler.setMicMuted(false);
            }
            
            micButton.classList.add('active');
            micButton.innerHTML = '<i class="fa-solid fa-microphone"></i>';
            
            if (state.currentChannel) {
                socket.emit('updateMuteStatus', { 
                    channelId: state.currentChannel, 
                    isMuted: false
                });
            }
        }
    }
    
    // Handle push-to-talk key up (Space bar)
    function handlePushToTalkKeyUp(e) {
        if (e.code === 'Space' && state.isPushToTalk && !state.isMuted) {
            e.preventDefault();
            state.isMuted = true;
            
            if (voiceHandler) {
                voiceHandler.setMicMuted(true);
            }
            
            micButton.classList.remove('active');
            micButton.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
            
            if (state.currentChannel) {
                socket.emit('updateMuteStatus', { 
                    channelId: state.currentChannel, 
                    isMuted: true
                });
            }
        }
    }
    
    // Send an emoji reaction
    function sendEmojiReaction(emoji) {
        if (!state.currentChannel) {
            showNotification('Join a channel first', 'error');
            return;
        }
        
        socket.emit('sendEmojiReaction', {
            channelId: state.currentChannel,
            emoji: emoji
        });
        
        // Display the emoji locally as well
        displayEmojiAnimation(emoji, state.username);
    }
    
    // Display an emoji animation
    function displayEmojiAnimation(emoji, username) {
        const emojiEl = document.createElement('div');
        emojiEl.className = 'emoji-flying';
        emojiEl.textContent = emoji;
        
        // Position near the user's avatar if they're in the participants list
        const userEl = document.querySelector(`[id^="participant-"]:contains('${username}')`);
        
        if (userEl) {
            const rect = userEl.getBoundingClientRect();
            emojiEl.style.left = `${rect.left + rect.width / 2}px`;
            emojiEl.style.top = `${rect.top}px`;
        } else {
            // Fallback position
            emojiEl.style.left = `${Math.random() * (window.innerWidth - 100) + 50}px`;
            emojiEl.style.top = `${window.innerHeight - 100}px`;
        }
        
        document.body.appendChild(emojiEl);
        
        // Remove after animation completes
        setTimeout(() => {
            emojiEl.remove();
        }, 2000);
    }
    
    // Toggle Pomodoro timer
    function toggleTimer() {
        if (state.timerRunning) {
            clearInterval(state.timerInterval);
            state.timerRunning = false;
            startTimer.textContent = 'Start';
            startTimer.classList.remove('pause');
        } else {
            state.timerInterval = setInterval(updateTimer, 1000);
            state.timerRunning = true;
            startTimer.textContent = 'Pause';
            startTimer.classList.add('pause');
        }
    }
    
    // Update the Pomodoro timer
    function updateTimer() {
        if (state.timerValue <= 0) {
            // Timer finished
            clearInterval(state.timerInterval);
            state.timerRunning = false;
            startTimer.textContent = 'Start';
            startTimer.classList.remove('pause');
            
            // Play a sound notification
            const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-alarm-digital-clock-beep-989.mp3');
            audio.play();
            
            showNotification('Study session completed!', 'success');
            resetPomodoroClock();
            return;
        }
        
        state.timerValue--;
        updateTimerDisplay();
    }
    
    // Reset the Pomodoro timer
    function resetPomodoroClock() {
        clearInterval(state.timerInterval);
        state.timerRunning = false;
        state.timerValue = 25 * 60; // 25 minutes
        updateTimerDisplay();
        startTimer.textContent = 'Start';
        startTimer.classList.remove('pause');
    }
    
    // Update the timer display
    function updateTimerDisplay() {
        const minutes = Math.floor(state.timerValue / 60);
        const seconds = state.timerValue % 60;
        
        timerMinutes.textContent = minutes.toString().padStart(2, '0');
        timerSeconds.textContent = seconds.toString().padStart(2, '0');
    }
    
    // Show a notification
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        notificationsContainer.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
    
    // Generate a random avatar
    function generateRandomAvatar() {
        const seed = Math.floor(Math.random() * 1000);
        const avatarUrl = `https://avatars.dicebear.com/api/adventurer/${seed}.svg`;
        userAvatarImg.src = avatarUrl;
        
        return avatarUrl;
    }
    
    // Get display name for a channel
    function getChannelDisplayName(channelId) {
        const map = {
            'class-8': 'Class 8',
            'class-9': 'Class 9',
            'class-10': 'Class 10',
            'class-11': 'Class 11',
            'class-12': 'Class 12',
            'entrance-prep': 'Entrance Prep'
        };
        
        return map[channelId] || channelId;
    }
    
    // Update last activity timestamp
    function updateActivity() {
        state.lastActivity = Date.now();
    }
    
    // Check for inactivity
    function checkForInactivity() {
        setInterval(() => {
            const now = Date.now();
            const inactiveTime = now - state.lastActivity;
            
            if (state.isConnected && state.currentChannel && inactiveTime >= state.inactivityTimeout) {
                showNotification('Disconnected due to inactivity', 'info');
                leaveCurrentChannel();
            }
        }, 60000); // Check every minute
    }
    
    // Initialize the application
    init();
});