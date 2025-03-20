/**
 * UI Controller
 * Handles UI-specific functionality
 */
document.addEventListener('DOMContentLoaded', () => {
    // Mobile menu handling
    const serverHeader = document.querySelector('.server-header');
    const channelsSection = document.querySelector('.channels-section');
    
    // Toggle mobile menu
    if (serverHeader && channelsSection) {
        serverHeader.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                channelsSection.classList.toggle('open');
            }
        });
    }
    
    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && 
            !e.target.closest('.server-header') && 
            !e.target.closest('.channels-section') &&
            channelsSection.classList.contains('open')) {
            channelsSection.classList.remove('open');
        }
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && channelsSection) {
            channelsSection.classList.remove('open');
        }
    });
    
    // Set up keyboard shortcuts
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Disconnect: Alt + D
            if (e.altKey && e.key === 'd') {
                const disconnectBtn = document.getElementById('disconnect-btn');
                if (disconnectBtn) {
                    disconnectBtn.click();
                }
            }
            
            // Toggle Mic: Alt + M
            if (e.altKey && e.key === 'm') {
                const micButton = document.getElementById('mic-button');
                if (micButton) {
                    micButton.click();
                }
            }
            
            // Toggle Noise Suppression: Alt + N
            if (e.altKey && e.key === 'n') {
                const toggleNoiseSuppression = document.getElementById('toggle-noise-suppression');
                if (toggleNoiseSuppression) {
                    toggleNoiseSuppression.click();
                }
            }
            
            // Toggle Push to Talk: Alt + T
            if (e.altKey && e.key === 't') {
                const togglePushToTalk = document.getElementById('toggle-push-to-talk');
                if (togglePushToTalk) {
                    togglePushToTalk.click();
                }
            }
            
            // Start/Pause Timer: Alt + P
            if (e.altKey && e.key === 'p') {
                const startTimer = document.getElementById('start-timer');
                if (startTimer) {
                    startTimer.click();
                }
            }
            
            // Reset Timer: Alt + R
            if (e.altKey && e.key === 'r') {
                const resetTimer = document.getElementById('reset-timer');
                if (resetTimer) {
                    resetTimer.click();
                }
            }
        });
    }
    
    // Focus username input when page loads
    function focusUsernameInput() {
        const usernameInput = document.getElementById('username-input');
        if (usernameInput) {
            setTimeout(() => {
                usernameInput.focus();
            }, 500);
        }
    }
    
    // Add ability to press Enter to login
    function setupEnterKeyLogin() {
        const usernameInput = document.getElementById('username-input');
        const userRoleSelect = document.getElementById('user-role');
        const loginButton = document.getElementById('login-button');
        
        if (usernameInput && loginButton) {
            usernameInput.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') {
                    loginButton.click();
                }
            });
        }
        
        if (userRoleSelect && loginButton) {
            userRoleSelect.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') {
                    loginButton.click();
                }
            });
        }
    }
    
    // Initialize UI enhancements
    function initUI() {
        setupKeyboardShortcuts();
        focusUsernameInput();
        setupEnterKeyLogin();
        
        // Display keyboard shortcuts in a tooltip
        const keyboardShortcuts = `
            <div class="shortcuts-info">
                <h3>Keyboard Shortcuts</h3>
                <div class="shortcut"><span>Alt + M</span> Toggle Mic</div>
                <div class="shortcut"><span>Alt + D</span> Disconnect</div>
                <div class="shortcut"><span>Alt + N</span> Toggle Noise Suppression</div>
                <div class="shortcut"><span>Alt + T</span> Toggle Push to Talk</div>
                <div class="shortcut"><span>Alt + P</span> Start/Pause Timer</div>
                <div class="shortcut"><span>Alt + R</span> Reset Timer</div>
                <div class="shortcut"><span>Space</span> Push to Talk (when enabled)</div>
            </div>
        `;
        
        // Create an info button that shows shortcuts on hover
        const infoButton = document.createElement('div');
        infoButton.className = 'info-button';
        infoButton.innerHTML = '<i class="fa-solid fa-keyboard"></i>';
        infoButton.title = 'Keyboard Shortcuts';
        
        const tooltipContainer = document.createElement('div');
        tooltipContainer.className = 'tooltip-container';
        tooltipContainer.innerHTML = keyboardShortcuts;
        
        infoButton.appendChild(tooltipContainer);
        document.body.appendChild(infoButton);
        
        // Style the info button and tooltip
        const style = document.createElement('style');
        style.textContent = `
            .info-button {
                position: fixed;
                bottom: 24px;
                left: 24px;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background-color: var(--bg-secondary);
                color: var(--text-muted);
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                z-index: 1000;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            }
            
            .info-button:hover {
                color: var(--text-primary);
            }
            
            .tooltip-container {
                position: absolute;
                bottom: 50px;
                left: 0;
                width: 280px;
                background-color: var(--bg-secondary);
                border-radius: 8px;
                padding: 16px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.2s ease, visibility 0.2s ease;
                transform: translateY(10px);
                pointer-events: none;
            }
            
            .info-button:hover .tooltip-container {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }
            
            .shortcuts-info h3 {
                margin-bottom: 12px;
                font-size: 0.9rem;
                color: var(--text-primary);
            }
            
            .shortcut {
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
                font-size: 0.8rem;
                color: var(--text-secondary);
            }
            
            .shortcut span {
                background-color: var(--bg-tertiary);
                padding: 2px 6px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 0.75rem;
            }
            
            @media (max-width: 768px) {
                .info-button {
                    bottom: 16px;
                    left: 16px;
                    width: 36px;
                    height: 36px;
                }
                
                .tooltip-container {
                    left: 0;
                    width: 260px;
                }
            }
        `;
        
        document.head.appendChild(style);
    }
    
    // Initialize UI
    initUI();
});