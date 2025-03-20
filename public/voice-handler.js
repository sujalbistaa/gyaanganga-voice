/**
 * Voice Handler class
 * Manages WebRTC connections for voice channels
 */
class VoiceHandler {
    constructor(socket) {
        this.socket = socket;
        this.localStream = null;
        this.peerConnections = {};
        this.channelId = null;
        this.audioContext = null;
        this.volume = 0.8;
        this.mediaConstraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        };

        // Set up socket event listeners for WebRTC signaling
        this.setupSocketEvents();
    }

    /**
     * Set up Socket.io event listeners for WebRTC signaling
     */
    setupSocketEvents() {
        // Handle incoming offer from a peer
        this.socket.on('offer', async (data) => {
            console.log('Received offer from peer:', data.from);
            
            // Create a new RTCPeerConnection if it doesn't exist
            if (!this.peerConnections[data.from]) {
                this.createPeerConnection(data.from);
            }
            
            try {
                // Set the remote description with the received offer
                await this.peerConnections[data.from].setRemoteDescription(new RTCSessionDescription(data.offer));
                
                // Create an answer to the offer
                const answer = await this.peerConnections[data.from].createAnswer();
                await this.peerConnections[data.from].setLocalDescription(answer);
                
                // Send the answer back to the peer
                this.socket.emit('answer', {
                    to: data.from,
                    answer: answer
                });
            } catch (error) {
                console.error('Error handling offer:', error);
            }
        });
        
        // Handle incoming answer to our offer
        this.socket.on('answer', async (data) => {
            console.log('Received answer from peer:', data.from);
            
            try {
                // Set the remote description with the received answer
                if (this.peerConnections[data.from]) {
                    await this.peerConnections[data.from].setRemoteDescription(new RTCSessionDescription(data.answer));
                }
            } catch (error) {
                console.error('Error handling answer:', error);
            }
        });
        
        // Handle incoming ICE candidate
        this.socket.on('iceCandidate', async (data) => {
            console.log('Received ICE candidate from peer:', data.from);
            
            try {
                if (this.peerConnections[data.from]) {
                    await this.peerConnections[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        });
        
        // Handle new user joining the channel
        this.socket.on('newUserJoined', (data) => {
            console.log('New user joined the channel:', data.userId);
            
            // Create a connection to the new user
            this.createPeerConnectionAndOffer(data.userId);
        });
        
        // Handle user leaving the channel
        this.socket.on('userDisconnected', (data) => {
            console.log('User disconnected:', data.userId);
            
            // Close the connection to the user
            this.closePeerConnection(data.userId);
        });
    }

    /**
     * Join a voice channel
     * @param {string} channelId - ID of the channel to join
     */
    async joinVoiceChannel(channelId) {
        this.channelId = channelId;
        
        try {
            console.log('Attempting to access microphone...');
            // Get user's microphone stream
            this.localStream = await navigator.mediaDevices.getUserMedia(this.mediaConstraints);
            console.log('Microphone access granted');
            
            // Set initial mute state
            this.setMicMuted(true);
            
            // Tell the server we're ready to start voice connections
            this.socket.emit('readyForVoice', { channelId }, (response) => {
                if (response.success) {
                    console.log('Ready for voice connections, peers:', response.peers);
                    // Create peer connections to all existing users in the channel
                    response.peers.forEach(peerId => {
                        this.createPeerConnectionAndOffer(peerId);
                    });
                } else {
                    console.error('Failed to ready for voice:', response.error);
                }
            });
            
            // Set up voice activity detection
            this.setupVoiceActivityDetection();
        } catch (error) {
            console.error('Error joining voice channel:', error);
            if (window.showNotification) {
                window.showNotification('Could not access microphone. Please ensure you have given permission.', 'error');
            } else {
                alert('Could not access microphone. Please ensure you have given permission.');
            }
        }
    }

    /**
     * Leave the current voice channel
     */
    leaveVoiceChannel() {
        // Stop sending audio
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        // Close all peer connections
        Object.keys(this.peerConnections).forEach(peerId => {
            this.closePeerConnection(peerId);
        });
        
        this.channelId = null;
        console.log('Voice channel left, all connections closed');
    }

    /**
     * Create a peer connection to a specific user
     * @param {string} peerId - ID of the peer to connect to
     */
    createPeerConnection(peerId) {
        console.log('Creating peer connection to:', peerId);
        
        // ICE servers configuration (STUN and TURN servers)
        const iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                // Free TURN server for testing
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ]
        };
        
        // Create the RTCPeerConnection
        const peerConnection = new RTCPeerConnection(iceServers);
        this.peerConnections[peerId] = peerConnection;
        
        // Add local stream tracks to the connection
        if (this.localStream) {
            console.log('Adding local tracks to peer connection');
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
        } else {
            console.warn('No local stream available to add to peer connection');
        }
        
        // Handle ICE candidate events
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Generated ICE candidate for peer', peerId);
                this.socket.emit('iceCandidate', {
                    to: peerId,
                    candidate: event.candidate
                });
            }
        };
        
        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(`Connection state for peer ${peerId}:`, peerConnection.connectionState);
        };
        
        // Handle incoming audio tracks
        peerConnection.ontrack = (event) => {
            console.log(`Received track from peer ${peerId}`);
            const stream = event.streams[0];
            
            // Create an audio element to play the remote stream
            const audioEl = document.createElement('audio');
            audioEl.srcObject = stream;
            audioEl.autoplay = true;
            audioEl.id = `audio-${peerId}`;
            
            // Adjust volume
            audioEl.volume = this.volume;
            
            // Add the audio element to the DOM (hidden)
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
            
            // Set up voice activity detection for this remote stream
            this.setupRemoteVoiceDetection(stream, peerId);
        };
        
        return peerConnection;
    }

    /**
     * Create a peer connection and send an offer to a specific user
     * @param {string} peerId - ID of the peer to connect to
     */
    async createPeerConnectionAndOffer(peerId) {
        // Create the peer connection
        const peerConnection = this.createPeerConnection(peerId);
        
        try {
            // Create an offer
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true
            });
            
            // Set the local description
            await peerConnection.setLocalDescription(offer);
            
            // Send the offer to the peer
            this.socket.emit('offer', {
                to: peerId,
                offer: offer
            });
            console.log('Sent offer to peer:', peerId);
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    /**
     * Close and remove a peer connection
     * @param {string} peerId - ID of the peer connection to close
     */
    closePeerConnection(peerId) {
        // Close the peer connection if it exists
        if (this.peerConnections[peerId]) {
            this.peerConnections[peerId].close();
            delete this.peerConnections[peerId];
        }
        
        // Remove the audio element for this peer
        const audioEl = document.getElementById(`audio-${peerId}`);
        if (audioEl) {
            audioEl.parentNode.removeChild(audioEl);
        }
    }

    /**
     * Set up voice activity detection for the local stream
     */
    setupVoiceActivityDetection() {
        if (!this.localStream) return;
        
        // Create an audio context if needed
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Create an analyser node
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        // Connect the local stream to the analyser
        const source = this.audioContext.createMediaStreamSource(this.localStream);
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Track speaking state
        let isSpeaking = false;
        let silenceTimer = null;
        
        // Check audio levels at regular intervals
        const checkAudioLevel = () => {
            if (!this.localStream) return;
            
            analyser.getByteFrequencyData(dataArray);
            
            // Calculate average volume level
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;
            
            // Threshold for speaking detection
            const threshold = 15; // Adjust based on testing
            
            // Check if speaking status changed
            if (average > threshold && !isSpeaking && this.localStream.getAudioTracks()[0].enabled) {
                isSpeaking = true;
                this.socket.emit('speakingStateChanged', { 
                    channelId: this.channelId,
                    isSpeaking: true
                });
                
                // Clear any existing silence timer
                if (silenceTimer) {
                    clearTimeout(silenceTimer);
                    silenceTimer = null;
                }
            } else if (average <= threshold && isSpeaking) {
                // Start a timer to detect sustained silence
                if (!silenceTimer) {
                    silenceTimer = setTimeout(() => {
                        isSpeaking = false;
                        this.socket.emit('speakingStateChanged', { 
                            channelId: this.channelId,
                            isSpeaking: false
                        });
                        silenceTimer = null;
                    }, 500); // Wait for 500ms of silence before changing state
                }
            }
            
            // Continue checking
            if (this.localStream) {
                requestAnimationFrame(checkAudioLevel);
            }
        };
        
        // Start checking audio levels
        checkAudioLevel();
    }

    /**
     * Set up voice activity detection for a remote stream
     * @param {MediaStream} stream - The remote audio stream
     * @param {string} peerId - ID of the peer
     */
    setupRemoteVoiceDetection(stream, peerId) {
        if (!stream || !this.audioContext) return;
        
        // Create an audio context if needed
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Create analyser node
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        // Connect the remote stream to the analyser
        const source = this.audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Track speaking state
        let isSpeaking = false;
        let silenceTimer = null;
        
        // Check audio levels at regular intervals
        const checkAudioLevel = () => {
            if (!this.peerConnections[peerId]) return;
            
            analyser.getByteFrequencyData(dataArray);
            
            // Calculate average volume level
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;
            
            // Threshold for speaking detection
            const threshold = 15; // Adjust based on testing
            
            // Update UI based on speaking status
            const participantEl = document.getElementById(`participant-${peerId}`);
            
            if (average > threshold && !isSpeaking) {
                isSpeaking = true;
                
                if (participantEl) {
                    participantEl.classList.add('speaking');
                }
                
                // Clear any existing silence timer
                if (silenceTimer) {
                    clearTimeout(silenceTimer);
                    silenceTimer = null;
                }
            } else if (average <= threshold && isSpeaking) {
                // Start a timer to detect sustained silence
                if (!silenceTimer) {
                    silenceTimer = setTimeout(() => {
                        isSpeaking = false;
                        
                        if (participantEl) {
                            participantEl.classList.remove('speaking');
                        }
                        
                        silenceTimer = null;
                    }, 500); // Wait for 500ms of silence before changing state
                }
            }
            
            // Continue checking if the peer connection still exists
            if (this.peerConnections[peerId]) {
                requestAnimationFrame(checkAudioLevel);
            }
        };
        
        // Start checking audio levels
        checkAudioLevel();
    }

    /**
     * Set microphone mute state
     * @param {boolean} muted - Whether the microphone should be muted
     */
    setMicMuted(muted) {
        if (!this.localStream) return;
        
        // Mute/unmute all audio tracks
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !muted;
        });
    }

    /**
     * Set output volume for all remote streams
     * @param {number} volume - Volume level (0 to 1)
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        
        // Update volume for all audio elements
        Object.keys(this.peerConnections).forEach(peerId => {
            const audioEl = document.getElementById(`audio-${peerId}`);
            if (audioEl) {
                audioEl.volume = this.volume;
            }
        });
    }

    /**
     * Toggle noise suppression
     * @param {boolean} enabled - Whether noise suppression should be enabled
     */
    toggleNoiseSuppression(enabled) {
        console.log('Noise suppression toggled:', enabled);
        // This is a simplified version without actually changing noise suppression
        // as browser support varies. The UI button still works though.
    }
}