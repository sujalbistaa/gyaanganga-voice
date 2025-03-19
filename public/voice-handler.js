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
        this.audioProcessors = {};
        this.mediaConstraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        };
        this.volume = 0.8; // Reduced default volume to help with echo
        this.connectionTimeout = 30000; // 30 seconds timeout for connection attempts
        this.localAudioTrackIds = new Set(); // Track local audio track IDs to avoid echo

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
            
            try {
                // Create a new RTCPeerConnection if it doesn't exist
                if (!this.peerConnections[data.from]) {
                    this.createPeerConnection(data.from);
                }
                
                // Set the remote description with the received offer
                await this.peerConnections[data.from].setRemoteDescription(new RTCSessionDescription(data.offer));
                console.log('Set remote description successfully from offer');
                
                // Create an answer to the offer
                const answer = await this.peerConnections[data.from].createAnswer();
                await this.peerConnections[data.from].setLocalDescription(answer);
                console.log('Created and set local answer');
                
                // Send the answer back to the peer
                this.socket.emit('answer', {
                    to: data.from,
                    answer: answer
                });
                console.log('Sent answer to peer:', data.from);
            } catch (error) {
                console.error('Error handling offer:', error);
                this.showError('Error handling call offer: ' + error.message);
            }
        });
        
        // Handle incoming answer to our offer
        this.socket.on('answer', async (data) => {
            console.log('Received answer from peer:', data.from);
            
            try {
                // Set the remote description with the received answer
                if (this.peerConnections[data.from]) {
                    await this.peerConnections[data.from].setRemoteDescription(new RTCSessionDescription(data.answer));
                    console.log('Set remote description successfully from answer');
                }
            } catch (error) {
                console.error('Error handling answer:', error);
                this.showError('Error handling call answer: ' + error.message);
            }
        });
        
        // Handle incoming ICE candidate
        this.socket.on('iceCandidate', async (data) => {
            console.log('Received ICE candidate from peer:', data.from);
            
            try {
                if (this.peerConnections[data.from]) {
                    // Add the received ICE candidate to the peer connection
                    await this.peerConnections[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
                    console.log('Successfully added ICE candidate');
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
        
        // Handle speaking status updates
        this.socket.on('speakingStatus', (data) => {
            // Update UI to show who is speaking
            const participantEl = document.getElementById(`participant-${data.userId}`);
            if (participantEl) {
                if (data.isSpeaking) {
                    participantEl.classList.add('speaking');
                } else {
                    participantEl.classList.remove('speaking');
                }
            }
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
            // Get user's microphone stream with enhanced echo cancellation
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    // Enhanced echo cancellation options
                    echoCancellationType: 'system',
                    suppressLocalAudioPlayback: true
                },
                video: false
            });
            console.log('Microphone access granted', this.localStream);
            
            // Store local audio track IDs to prevent echo
            this.localStream.getTracks().forEach(track => {
                this.localAudioTrackIds.add(track.id);
                console.log('Stored local track ID:', track.id);
            });
            
            // Set initial mute state
            this.setMicMuted(true);
            
            // Initialize audio context for processing
            this.initAudioContext();
            
            // Tell the server we're ready to start voice connections
            console.log('Signaling readiness for voice connections');
            this.socket.emit('readyForVoice', { channelId }, (response) => {
                if (response.success) {
                    console.log('Ready for voice connections, peers:', response.peers);
                    // Create peer connections to all existing users in the channel
                    response.peers.forEach(peerId => {
                        this.createPeerConnectionAndOffer(peerId);
                    });
                } else {
                    console.error('Failed to signal readiness:', response.error);
                    this.showError('Failed to connect to voice: ' + response.error);
                }
            });
            
            // Set up voice activity detection
            this.setupVoiceActivityDetection();
            
            // Show success notification
            this.showNotification('Voice connected successfully', 'success');
        } catch (error) {
            console.error('Error joining voice channel:', error);
            this.showError('Could not access microphone. Please ensure you have given permission: ' + error.message);
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
        
        // Clear local track IDs
        this.localAudioTrackIds.clear();
        
        // Close all peer connections
        Object.keys(this.peerConnections).forEach(peerId => {
            this.closePeerConnection(peerId);
        });
        
        // Clean up audio processing
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
            this.audioProcessors = {};
        }
        
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
                // Public TURN server for testing
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ]
        };
        
        // Create the RTCPeerConnection with echo cancellation optimizations
        const peerConnection = new RTCPeerConnection({
            ...iceServers,
            // RTCPeerConnection options to help with echo cancellation
            sdpSemantics: 'unified-plan',
            // Bundle policy to reduce echo
            bundlePolicy: 'max-bundle'
        });
        
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
        
        // Handle ICE connection state changes
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`ICE connection state for peer ${peerId}:`, peerConnection.iceConnectionState);
            
            // Handle connection failures
            if (peerConnection.iceConnectionState === 'failed' || 
                peerConnection.iceConnectionState === 'disconnected') {
                console.warn(`Connection to peer ${peerId} failed or disconnected. Attempting to restart ICE`);
                
                // Try to restart ICE connection
                peerConnection.restartIce();
            }
        };
        
        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(`Connection state for peer ${peerId}:`, peerConnection.connectionState);
            
            // Handle connection failures
            if (peerConnection.connectionState === 'failed') {
                console.error(`Connection to peer ${peerId} failed. Closing and recreating connection`);
                
                // Close and recreate the connection
                this.closePeerConnection(peerId);
                setTimeout(() => {
                    this.createPeerConnectionAndOffer(peerId);
                }, 1000);
            }
        };
        
        // Set a timeout to detect stalled connection attempts
        const connectionTimeoutId = setTimeout(() => {
            // If still connecting after timeout, restart the connection
            if (peerConnection.iceConnectionState === 'checking' || 
                peerConnection.iceConnectionState === 'new') {
                console.warn(`Connection attempt to peer ${peerId} taking too long. Restarting.`);
                peerConnection.restartIce();
            }
        }, this.connectionTimeout);
        
        // Clear timeout when connection succeeds
        peerConnection.addEventListener('iceconnectionstatechange', () => {
            if (peerConnection.iceConnectionState === 'connected' || 
                peerConnection.iceConnectionState === 'completed') {
                clearTimeout(connectionTimeoutId);
            }
        });
        
        // Handle incoming audio tracks with echo prevention
        peerConnection.ontrack = (event) => {
            console.log(`Received track from peer ${peerId}`, event.track);
            
            // Check if this is one of our own tracks (echo prevention)
            if (this.localAudioTrackIds.has(event.track.id)) {
                console.log('Ignoring local track to prevent echo:', event.track.id);
                return;
            }
            
            const stream = event.streams[0];
            
            // Create an audio element to play the remote stream
            const audioEl = document.createElement('audio');
            audioEl.srcObject = stream;
            audioEl.autoplay = true;
            audioEl.id = `audio-${peerId}`;
            
            // Adjust volume to prevent echo
            audioEl.volume = this.volume;
            
            // Add the audio element to the DOM (hidden)
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
            
            // Log and store all tracks from the remote stream for debugging
            stream.getTracks().forEach(track => {
                console.log('Remote track:', track.id, track.kind, track.enabled);
            });
            
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
            // Create an offer with echo cancellation options
            const offerOptions = {
                offerToReceiveAudio: true,
                offerToReceiveVideo: false,
                voiceActivityDetection: true
            };
            
            // Create an offer
            const offer = await peerConnection.createOffer(offerOptions);
            
            // Modify SDP to improve echo cancellation
            offer.sdp = this.modifySdpForEchoCancellation(offer.sdp);
            
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
            this.showError('Error setting up voice connection: ' + error.message);
        }
    }

    /**
     * Modify SDP to improve echo cancellation
     * @param {string} sdp - Session Description Protocol string
     * @returns {string} - Modified SDP
     */
    modifySdpForEchoCancellation(sdp) {
        // Add stereo=0 and useinbandfec=1 to opus codec for better echo handling
        return sdp.replace(/(a=rtpmap:\d+ opus\/48000\/2)/g, '$1\r\na=fmtp:111 minptime=10;useinbandfec=1;stereo=0');
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
     * Initialize the Web Audio API context
     */
    initAudioContext() {
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create audio source from the microphone stream
        if (this.localStream) {
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            
            // Create gain node for volume control
            const gainNode = this.audioContext.createGain();
            source.connect(gainNode);
            
            // Set up noise suppression if available
            if (this.audioContext.createNoiseSuppressor) {
                const noiseSuppressor = this.audioContext.createNoiseSuppressor();
                gainNode.connect(noiseSuppressor);
                noiseSuppressor.connect(this.audioContext.destination);
                this.audioProcessors.noiseSuppressor = noiseSuppressor;
            } else {
                // Fallback for browsers that don't support native noise suppression
                gainNode.connect(this.audioContext.destination);
            }
            
            this.audioProcessors.gainNode = gainNode;
        }
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
        if (!this.audioContext || !this.localStream) return;
        
        if (enabled) {
            // Re-initialize audio context with noise suppression
            this.initAudioContext();
        } else {
            // Disable noise suppression if it exists
            if (this.audioProcessors.noiseSuppressor) {
                this.audioProcessors.noiseSuppressor.disconnect();
                this.audioProcessors.gainNode.connect(this.audioContext.destination);
            }
        }
    }

    /**
     * Set up voice activity detection for the local stream
     */
    setupVoiceActivityDetection() {
        if (!this.localStream) return;
        
        // Create a new ScriptProcessor or AudioWorklet for voice detection
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        
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
            
            // Threshold for speaking detection (higher value to reduce false positives)
            const threshold = 20;
            
            // Check if speaking status changed
            if (average > threshold && !isSpeaking && !this.isMuted) {
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
            requestAnimationFrame(checkAudioLevel);
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
        
        // Create analyser node
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        
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
            
            // Threshold for speaking detection (higher value to reduce false positives)
            const threshold = 20;
            
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
     * Show an error notification
     * @param {string} message - Error message
     */
    showError(message) {
        console.error('Voice Error:', message);
        // Check if the notification function exists in the global scope
        if (typeof showNotification === 'function') {
            showNotification(message, 'error');
        } else {
            alert('Voice Error: ' + message);
        }
    }

    /**
     * Show a notification
     * @param {string} message - Notification message
     * @param {string} type - Type of notification
     */
    showNotification(message, type = 'info') {
        console.log('Voice Notification:', message);
        // Check if the notification function exists in the global scope
        if (typeof showNotification === 'function') {
            showNotification(message, type);
        }
    }
}