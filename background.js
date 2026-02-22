// Lead Mappo GMap Extractor - Background Service Worker

// API Base URL - UPDATE THIS FOR YOUR SERVER
const API_BASE = 'https://admin.leadmappo.com/api';

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    const tabs = await chrome.tabs.query({ url: dashboardUrl });
    
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
        await chrome.tabs.create({ url: dashboardUrl });
    }
});

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Message:', message.type);
    
    switch(message.type) {
        case 'LOGIN':
            loginUser(message.email, message.password).then(sendResponse);
            return true;
        case 'VERIFY_LICENSE':
            verifyLicense(message.licenseKey).then(sendResponse);
            return true;
        case 'LOGOUT':
            logoutUser().then(sendResponse);
            return true;
        case 'CHECK_AUTH':
            checkAuth().then(sendResponse);
            return true;
        case 'REFRESH_USER_DATA':
            refreshUserData().then(sendResponse);
            return true;
        case 'CHECK_EXPORT_CREDITS':
            checkExportCredits().then(sendResponse);
            return true;
        case 'LOG_ACTIVITY':
            logActivity(message.userId, message.action, message.details);
            break;
        case 'START_SCAN':
            startScan(message.keyword, message.location);
            break;
        case 'STOP_SCAN':
            stopScan();
            break;
        case 'GET_STATUS':
            getStatus().then(sendResponse);
            return true;
        case 'DATA_EXTRACTED':
            handleExtractedData(message.data);
            break;
        case 'SCAN_COMPLETE':
            handleScanComplete();
            break;
        case 'SCROLL_HEARTBEAT':
            handleScrollHeartbeat(sender.tab?.id);
            break;
    }
});

// Check export credits before allowing export
async function checkExportCredits() {
    const { licenseKey } = await chrome.storage.local.get('licenseKey');
    
    if (!licenseKey) {
        return { success: false, can_proceed: false, message: 'Please login first' };
    }
    
    try {
        const response = await fetch(`${API_BASE}/check-credits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: licenseKey, action_type: 'export', count: 1 })
        });
        
        return await response.json();
    } catch (e) {
        console.error('[Background] Export credit check error:', e);
        return { success: false, can_proceed: true, message: 'Credit check failed, allowing export' };
    }
}

// Auth functions
async function loginUser(email, password) {
    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                email, 
                password,
                device_type: 'extension',
                device_info: navigator.userAgent || 'Chrome Extension'
            })
        });
        
        const data = await response.json();
        
        if (data.success && data.user) {
            // Store device token for session verification
            await chrome.storage.local.set({ 
                user: data.user,
                isLoggedIn: true,
                licenseVerified: false,
                deviceToken: data.device_token // Store device token for single-device enforcement
            });
            return { success: true, user: data.user };
        } else {
            return { success: false, message: data.message || data.detail || 'Login failed' };
        }
    } catch (e) {
        console.error('[Background] Login error:', e);
        return { success: false, message: 'Connection error. Please check your internet.' };
    }
}

async function verifyLicense(licenseKey) {
    try {
        const response = await fetch(`${API_BASE}/verify-license`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: licenseKey })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Update stored user data with license info
            const { user = {} } = await chrome.storage.local.get('user');
            const updatedUser = { ...user, ...data.data, license_key: licenseKey };
            
            await chrome.storage.local.set({ 
                user: updatedUser,
                licenseVerified: true,
                licenseKey: licenseKey
            });
            
            return { success: true, data: data.data };
        } else {
            return { success: false, message: data.message || data.detail || 'Invalid license key' };
        }
    } catch (e) {
        console.error('[Background] License verification error:', e);
        return { success: false, message: 'Connection error. Please check your internet.' };
    }
}

async function logoutUser() {
    await chrome.storage.local.remove([
        'user', 'isLoggedIn', 'licenseVerified', 'licenseKey',
        'extractedData', 'scanStatus', 'currentKeyword', 'currentLocation'
    ]);
    return { success: true };
}

async function checkAuth() {
    const data = await chrome.storage.local.get(['user', 'isLoggedIn', 'licenseVerified']);
    return {
        isLoggedIn: data.isLoggedIn || false,
        licenseVerified: data.licenseVerified || false,
        user: data.user || null
    };
}

// Refresh user data from the server
async function refreshUserData() {
    try {
        const { user, licenseKey } = await chrome.storage.local.get(['user', 'licenseKey']);
        
        if (!user?.email || !licenseKey) {
            return { success: false, message: 'No user session' };
        }
        
        // Fetch fresh user data using the user-data endpoint
        const response = await fetch(`${API_BASE}/user-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: licenseKey })
        });
        
        const data = await response.json();
        
        if (data.success && data.user) {
            // Merge new data with existing user data
            const updatedUser = { ...user, ...data.user };
            await chrome.storage.local.set({ user: updatedUser });
            return { success: true, user: updatedUser };
        } else {
            return { success: false, message: data.message || 'Failed to refresh' };
        }
    } catch (e) {
        console.error('[Background] Refresh user data error:', e);
        return { success: false, message: 'Connection error' };
    }
}

// SECURITY: Verify session is still valid (single device enforcement)
async function verifySession() {
    const { licenseKey, deviceToken, isLoggedIn } = await chrome.storage.local.get(['licenseKey', 'deviceToken', 'isLoggedIn']);
    
    if (!isLoggedIn || !licenseKey || !deviceToken) {
        return { valid: true }; // Not logged in, nothing to verify
    }
    
    try {
        const response = await fetch(`${API_BASE}/verify-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                license_key: licenseKey, 
                device_token: deviceToken 
            })
        });
        
        const data = await response.json();
        
        if (!data.valid && data.action === 'force_logout') {
            // Session invalidated - force logout
            console.log('[Background] Session invalidated - forcing logout');
            await forceLogout(data.message || 'Session expired');
            return { valid: false, message: data.message, reason: data.reason };
        }
        
        return { valid: true };
    } catch (e) {
        console.error('[Background] Session verification error:', e);
        return { valid: true }; // Fail open on network error
    }
}

// Force logout when session is invalidated (another device logged in)
async function forceLogout(message) {
    await chrome.storage.local.set({ 
        user: null, 
        isLoggedIn: false, 
        licenseKey: null, 
        licenseVerified: false,
        deviceToken: null
    });
    
    // Notify any open dashboard
    notifyDashboard({ 
        type: 'FORCE_LOGOUT', 
        message: message || 'You have been logged out.',
        reason: 'another_device'
    });
}

// Set up periodic session verification (every 2 minutes)
chrome.alarms.create('sessionVerification', { periodInMinutes: 2 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'sessionVerification') {
        const result = await verifySession();
        if (!result.valid) {
            console.log('[Background] Session invalid:', result.message);
        }
    }
    // ... existing alarm handlers
});

async function logActivity(userId, action, details = {}) {
    try {
        await fetch(`${API_BASE}/log-activity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, action, details })
        });
    } catch (e) {
        console.error('[Background] Activity log error:', e);
    }
}

// Scan functions
async function startScan(keyword, location) {
    // SECURITY: First verify session is still valid
    const sessionCheck = await verifySession();
    if (!sessionCheck.valid) {
        notifyDashboard({ 
            type: 'SCAN_ERROR', 
            message: sessionCheck.message || 'Session expired. Please login again.',
            error_code: 'SESSION_INVALID'
        });
        return;
    }
    
    // CRITICAL: Check if user has extraction credits before starting scan
    const { licenseKey, user } = await chrome.storage.local.get(['licenseKey', 'user']);
    
    if (!licenseKey) {
        notifyDashboard({ type: 'SCAN_ERROR', message: 'Please login and verify your license first.' });
        return;
    }
    
    try {
        const creditCheck = await fetch(`${API_BASE}/check-credits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license_key: licenseKey, action_type: 'extraction', count: 1 })
        });
        
        const creditResult = await creditCheck.json();
        
        if (!creditResult.can_proceed) {
            notifyDashboard({ 
                type: 'SCAN_ERROR', 
                message: creditResult.message || 'Insufficient extraction credits',
                error_code: creditResult.error_code
            });
            return;
        }
    } catch (e) {
        console.error('[Background] Credit check error:', e);
        // Allow scan to proceed if credit check fails (network error)
    }
    
    const searchQuery = `${keyword} in ${location}`;
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
    
    await chrome.storage.local.set({
        scanStatus: 'running',
        currentKeyword: keyword,
        currentLocation: location,
        extractedData: [],
        lastScrollHeartbeat: Date.now()
    });
    
    // Save to history
    const { searchHistory = [] } = await chrome.storage.local.get('searchHistory');
    searchHistory.unshift({ keyword, location, timestamp: Date.now() });
    await chrome.storage.local.set({ searchHistory: searchHistory.slice(0, 20) });
    
    const tab = await chrome.tabs.create({ url: mapsUrl, active: true });
    await chrome.storage.local.set({ scanTabId: tab.id });
    
    // Start scroll keepalive alarm
    await startScrollKeepalive();
    
    // Log activity
    if (user?.id) {
        logActivity(user.id, 'extraction', { keyword, location });
    }
}

async function stopScan() {
    await chrome.storage.local.set({ scanStatus: 'stopped' });
    
    // Stop scroll keepalive alarm
    await stopScrollKeepalive();
    
    const { scanTabId } = await chrome.storage.local.get('scanTabId');
    if (scanTabId) {
        try {
            await chrome.tabs.sendMessage(scanTabId, { type: 'STOP_SCAN' });
        } catch (e) {}
    }
    notifyDashboard({ type: 'SCAN_STOPPED' });
}

async function getStatus() {
    return await chrome.storage.local.get([
        'scanStatus', 'currentKeyword', 'currentLocation', 
        'extractedData', 'searchHistory', 'isLoggedIn', 'user'
    ]);
}

async function handleExtractedData(newData) {
    const { extractedData = [] } = await chrome.storage.local.get('extractedData');
    const existingPlaceIds = new Set(extractedData.map(d => d.place_id));
    const uniqueNewData = newData.filter(d => d.place_id && !existingPlaceIds.has(d.place_id));
    
    const allData = [...extractedData, ...uniqueNewData];
    await chrome.storage.local.set({ extractedData: allData });
    notifyDashboard({ type: 'DATA_UPDATED', count: allData.length });
}

async function handleScanComplete() {
    await chrome.storage.local.set({ scanStatus: 'complete' });
    await stopScrollKeepalive();
    notifyDashboard({ type: 'SCAN_COMPLETE' });
}

async function notifyDashboard(message) {
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    try {
        const tabs = await chrome.tabs.query({ url: dashboardUrl });
        for (const tab of tabs) {
            try {
                await chrome.tabs.sendMessage(tab.id, message);
            } catch (e) {}
        }
    } catch (e) {}
}

// ========== SCROLL KEEPALIVE MECHANISM ==========
// Uses Chrome Alarms API to ensure scrolling continues even when tab is in background

const SCROLL_ALARM_NAME = 'scroll_keepalive';
let lastHeartbeat = 0;
const HEARTBEAT_TIMEOUT = 10000; // If no heartbeat for 10 seconds, nudge the content script

// Handle scroll heartbeat from content script
async function handleScrollHeartbeat(tabId) {
    lastHeartbeat = Date.now();
    await chrome.storage.local.set({ lastScrollHeartbeat: lastHeartbeat, scrollTabId: tabId });
}

// Alarm listener - checks if scrolling has stalled
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === SCROLL_ALARM_NAME) {
        const { scanStatus, lastScrollHeartbeat, scanTabId } = await chrome.storage.local.get([
            'scanStatus', 'lastScrollHeartbeat', 'scanTabId'
        ]);
        
        // Only act if scan is supposed to be running
        if (scanStatus !== 'running') {
            await chrome.alarms.clear(SCROLL_ALARM_NAME);
            return;
        }
        
        const timeSinceHeartbeat = Date.now() - (lastScrollHeartbeat || 0);
        
        // If heartbeat is stale, nudge the content script to resume
        if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT && scanTabId) {
            console.log('[Background] Scroll heartbeat stale, nudging content script...');
            try {
                await chrome.tabs.sendMessage(scanTabId, { type: 'RESUME_SCROLL' });
            } catch (e) {
                console.log('[Background] Could not reach content script:', e);
            }
        }
    }
});

// Start the scroll keepalive alarm when a scan starts
async function startScrollKeepalive() {
    await chrome.alarms.create(SCROLL_ALARM_NAME, { periodInMinutes: 0.25 }); // Check every 15 seconds
    console.log('[Background] Scroll keepalive alarm started');
}

// Stop the scroll keepalive alarm
async function stopScrollKeepalive() {
    await chrome.alarms.clear(SCROLL_ALARM_NAME);
    console.log('[Background] Scroll keepalive alarm stopped');
}

console.log('[Lead Mappo GMap Extractor] Background service worker initialized');
