// Lead Mappo GMap Extractor - Enhanced Dashboard Controller
// Export columns: Business Name, Phone, Website, Address, City, State, 
// Postal Code, Country, Latitude, Longitude, Average Rating, Total Reviews, Place URL, Place ID, 
// Search Keyword, Search Location (16 columns)

const API_BASE = 'https://admin.leadmappo.com/api';

let currentData = [];
let currentUser = null;
let refreshInterval = null;
let userDataRefreshInterval = null;
const USER_DATA_REFRESH_INTERVAL = 60000; // Refresh user data every 60 seconds

document.addEventListener('DOMContentLoaded', init);

async function init() {
    setupEventListeners();
    await checkAuth();
    
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'DATA_UPDATED' || msg.type === 'SCAN_COMPLETE' || msg.type === 'SCAN_STOPPED') {
            loadData();
            if (msg.type !== 'DATA_UPDATED') {
                updateStatus(msg.type === 'SCAN_COMPLETE' ? 'Complete' : 'Stopped');
                stopAutoRefresh();
            }
        } else if (msg.type === 'SCAN_ERROR') {
            // Handle scan errors (e.g., no credits)
            showCreditError(msg.message, msg.error_code);
            updateStatus('Error');
        } else if (msg.type === 'FORCE_LOGOUT') {
            // Handle force logout (another device logged in)
            handleForceLogout(msg.message, msg.reason);
        }
    });
}

// Handle force logout when another device logs in
function handleForceLogout(message, reason) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'force-logout-alert';
    alertDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.9);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    alertDiv.innerHTML = `
        <div style="background: white; padding: 32px; border-radius: 16px; max-width: 400px; text-align: center;">
            <div style="width: 64px; height: 64px; background: #fef2f2; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
                <i class="fas fa-exclamation-triangle" style="font-size: 28px; color: #dc2626;"></i>
            </div>
            <h3 style="margin: 0 0 12px 0; color: #1f2937;">Session Ended</h3>
            <p style="color: #6b7280; margin: 0 0 24px 0; font-size: 14px;">${message || 'You have been logged out because your account was accessed from another device.'}</p>
            <p style="color: #ef4444; font-size: 12px; margin: 0 0 24px 0;"><i class="fas fa-shield-alt"></i> Only one device can use your license at a time.</p>
            <button onclick="location.reload()" style="background: var(--primary); color: white; border: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; cursor: pointer; width: 100%;">
                <i class="fas fa-sign-in-alt"></i> Login Again
            </button>
        </div>
    `;
    document.body.appendChild(alertDiv);
}

function showCreditError(message, errorCode) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'credit-alert';
    alertDiv.innerHTML = `
        <div style="background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 16px; border-radius: 12px; margin-bottom: 16px; animation: slideIn 0.3s ease;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <i class="fas fa-exclamation-circle" style="font-size: 24px;"></i>
                <div>
                    <strong style="display: block; margin-bottom: 4px;">Credit Limit Reached</strong>
                    <span style="font-size: 13px; opacity: 0.9;">${message}</span>
                </div>
            </div>
            ${errorCode === 'NO_EXTRACTION_CREDITS' || errorCode === 'NO_EXPORT_CREDITS' ? 
                `<a href="https://leadmappo.com/account.html#topup" target="_blank" style="display: block; margin-top: 12px; background: white; color: #dc2626; padding: 8px 16px; border-radius: 8px; text-decoration: none; text-align: center; font-weight: 600;">
                    <i class="fas fa-coins me-2"></i>Buy More Credits
                </a>` : ''}
        </div>
    `;
    
    const existingAlert = document.querySelector('.credit-alert');
    if (existingAlert) existingAlert.remove();
    
    const mainContent = document.querySelector('.main-content') || document.body;
    mainContent.insertBefore(alertDiv, mainContent.firstChild);
    
    setTimeout(() => alertDiv.remove(), 10000);
}

function setupEventListeners() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    
    // License form
    document.getElementById('licenseForm').addEventListener('submit', handleLicenseActivation);
    document.getElementById('backToLogin').addEventListener('click', () => showScreen('loginScreen'));
    
    // Main controls
    document.getElementById('startBtn').addEventListener('click', startScan);
    document.getElementById('stopBtn').addEventListener('click', stopScan);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);
    document.getElementById('exportExcelBtn').addEventListener('click', exportExcel);
    document.getElementById('clearBtn').addEventListener('click', clearData);
    
    // User menu
    document.getElementById('userMenuBtn').addEventListener('click', toggleUserMenu);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('viewPlanBtn').addEventListener('click', () => { hideUserMenu(); showModal('planModal'); });
    document.getElementById('contactBtn').addEventListener('click', () => { hideUserMenu(); showModal('contactModal'); });
    
    // History & Help
    document.getElementById('historyBtn').addEventListener('click', showHistory);
    document.getElementById('helpBtn').addEventListener('click', () => showModal('helpModal'));
    
    // Policy links
    document.getElementById('privacyLink').addEventListener('click', (e) => { e.preventDefault(); showModal('privacyModal'); });
    document.getElementById('termsLink').addEventListener('click', (e) => { e.preventDefault(); showModal('termsModal'); });
    document.getElementById('refundLink').addEventListener('click', (e) => { e.preventDefault(); showModal('refundModal'); });
    
    // Modal close buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => hideModal(btn.getAttribute('data-close')));
    });
    
    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal(modal.id);
        });
    });
    
    // Close user menu on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.user-menu')) hideUserMenu();
    });
    
    // Enter key handlers
    ['keyword', 'location'].forEach(id => {
        document.getElementById(id).addEventListener('keypress', (e) => {
            if (e.key === 'Enter') startScan();
        });
    });
}

// Screen management
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function showModal(modalId) {
    document.getElementById(modalId).classList.add('show');
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

function toggleUserMenu() {
    document.getElementById('userDropdown').classList.toggle('show');
}

function hideUserMenu() {
    document.getElementById('userDropdown').classList.remove('show');
}

// Auth
async function checkAuth() {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_AUTH' });
    if (response.isLoggedIn && response.user) {
        currentUser = response.user;
        if (response.licenseVerified) {
            showMainScreen();
        } else {
            showScreen('licenseScreen');
        }
    } else {
        showScreen('loginScreen');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    
    errorEl.textContent = 'Logging in...';
    errorEl.style.color = 'var(--primary)';
    
    const response = await chrome.runtime.sendMessage({ type: 'LOGIN', email, password });
    
    if (response.success) {
        errorEl.textContent = '';
        currentUser = response.user;
        showScreen('licenseScreen');
    } else {
        errorEl.textContent = response.message || 'Login failed';
        errorEl.style.color = 'var(--danger)';
    }
}

async function handleLicenseActivation(e) {
    e.preventDefault();
    const licenseKey = document.getElementById('licenseKey').value.toUpperCase().trim();
    const errorEl = document.getElementById('licenseError');
    
    errorEl.textContent = 'Verifying license...';
    errorEl.style.color = 'var(--primary)';
    
    const response = await chrome.runtime.sendMessage({ type: 'VERIFY_LICENSE', licenseKey });
    
    if (response.success) {
        errorEl.textContent = '';
        if (response.data) currentUser = { ...currentUser, ...response.data };
        showMainScreen();
    } else {
        errorEl.textContent = response.message || 'Invalid license key';
        errorEl.style.color = 'var(--danger)';
    }
}

function showMainScreen() {
    showScreen('mainScreen');
    
    updateUserDisplay();
    
    loadData();
    checkScanStatus();
    
    // Start periodic user data refresh
    startUserDataRefresh();
    
    // Check for extension updates
    checkForUpdates();
}

// Check for extension updates
async function checkForUpdates() {
    const CURRENT_VERSION = '2.3.0'; // Update this when releasing new versions
    
    try {
        const response = await fetch('https://admin.leadmappo.com/api/check-update?version=' + CURRENT_VERSION);
        const data = await response.json();
        
        if (data.success && data.update_available) {
            // Show update notification
            showUpdateNotification(data.latest_version, data.download_url, data.changelog);
        }
    } catch (e) {
        console.log('[Lead Mappo] Failed to check for updates:', e);
    }
}

// Show update notification banner
function showUpdateNotification(version, downloadUrl, changelog) {
    // Check if notification already exists
    if (document.getElementById('updateBanner')) return;
    
    const banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.innerHTML = `
        <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.3);">
            <div style="display: flex; align-items: center; gap: 12px;">
                <i class="fas fa-bell" style="font-size: 20px;"></i>
                <div>
                    <strong>Update Available: v${version}</strong>
                    <p style="margin: 0; font-size: 12px; opacity: 0.9;">${changelog || 'New features and improvements available!'}</p>
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <a href="${downloadUrl}" download style="background: white; color: #d97706; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px;">
                    <i class="fas fa-download"></i> Download
                </a>
                <button onclick="this.parentElement.parentElement.parentElement.remove()" style="background: transparent; border: 2px solid white; color: white; padding: 6px 12px; border-radius: 6px; cursor: pointer;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `;
    
    const mainScreen = document.getElementById('mainScreen');
    mainScreen.insertBefore(banner, mainScreen.firstChild);
}

// Updates the UI with current user data
function updateUserDisplay() {
    if (!currentUser) return;
    
    document.getElementById('userName').textContent = currentUser.name || 'User';
    document.getElementById('userEmail').textContent = currentUser.email || '';
    document.getElementById('planName').textContent = currentUser.plan || 'Basic';
    document.getElementById('planExpires').textContent = currentUser.days_remaining 
        ? `Expires in ${currentUser.days_remaining} days` : '';
    
    const maxExt = currentUser.max_extractions || -1;
    const maxExp = currentUser.max_exports || -1;
    const usedExt = currentUser.total_extractions || 0;
    const usedExp = currentUser.total_exports || 0;
    
    // Calculate remaining credits
    const remainingExt = maxExt == -1 ? -1 : Math.max(0, maxExt - usedExt);
    const remainingExp = maxExp == -1 ? -1 : Math.max(0, maxExp - usedExp);
    
    document.getElementById('extractionCredits').textContent = maxExt > 0 
        ? `${remainingExt}/${maxExt} left` 
        : `${usedExt} used (Unlimited)`;
    document.getElementById('exportCredits').textContent = maxExp > 0 
        ? `${remainingExp}/${maxExp} left` 
        : `${usedExp} used (Unlimited)`;
    
    // Show warning if low credits
    if (remainingExt >= 0 && remainingExt <= 10 && maxExt > 0) {
        document.getElementById('extractionCredits').style.color = '#dc2626';
    }
    if (remainingExp >= 0 && remainingExp <= 5 && maxExp > 0) {
        document.getElementById('exportCredits').style.color = '#dc2626';
    }
    
    // Plan modal
    document.getElementById('modalPlanName').textContent = currentUser.plan || currentUser.plan_name || 'Free Trial';
    document.getElementById('modalLicenseKey').textContent = currentUser.license_key || '-';
    document.getElementById('modalExpiresAt').textContent = currentUser.license_expires_at 
        ? formatDateOnlyIST(currentUser.license_expires_at) : '-';
    document.getElementById('modalDaysLeft').textContent = currentUser.days_remaining ? `${currentUser.days_remaining} days` : '-';
    document.getElementById('modalExtractions').textContent = maxExt > 0 
        ? `${remainingExt} remaining (${usedExt} used of ${maxExt})` 
        : `${usedExt} used (Unlimited)`;
    document.getElementById('modalExports').textContent = maxExp > 0 
        ? `${remainingExp} remaining (${usedExp} used of ${maxExp})` 
        : `${usedExp} used (Unlimited)`;
    
    // Referral code
    if (document.getElementById('modalReferralCode')) {
        document.getElementById('modalReferralCode').textContent = currentUser.referral_code || '-';
    }
    
    const badge = document.getElementById('modalPlanStatus');
    badge.textContent = currentUser.days_remaining > 0 ? 'Active' : 'Expired';
    badge.classList.toggle('expired', currentUser.days_remaining <= 0);
    
    // Load referral info from API
    loadReferralInfo();
}

// Fetches fresh user data from the server
async function refreshUserData() {
    if (!currentUser || !currentUser.email) return;
    
    try {
        const response = await chrome.runtime.sendMessage({ type: 'REFRESH_USER_DATA' });
        if (response && response.success && response.user) {
            currentUser = { ...currentUser, ...response.user };
            updateUserDisplay();
            console.log('[Lead Mappo] User data refreshed:', response.user);
        } else {
            console.log('[Lead Mappo] Refresh response:', response);
        }
    } catch (e) {
        console.log('[Lead Mappo] Could not refresh user data:', e);
    }
}

// Manual refresh button handler
async function manualRefreshUserData() {
    const refreshBtn = document.getElementById('refreshUserDataBtn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fas fa-sync fa-spin"></i>';
    }
    
    await refreshUserData();
    
    if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="fas fa-sync"></i>';
    }
}

// Starts periodic user data refresh
function startUserDataRefresh() {
    stopUserDataRefresh();
    userDataRefreshInterval = setInterval(refreshUserData, USER_DATA_REFRESH_INTERVAL);
}

// Stops periodic user data refresh
function stopUserDataRefresh() {
    if (userDataRefreshInterval) {
        clearInterval(userDataRefreshInterval);
        userDataRefreshInterval = null;
    }
}

async function loadReferralInfo() {
    if (!currentUser || !currentUser.email) return;
    
    try {
        const response = await fetch(`${API_BASE}/referral-info?email=${encodeURIComponent(currentUser.email)}`);
        const data = await response.json();
        
        if (data.success && data.referral_code) {
            currentUser.referral_code = data.referral_code;
            if (document.getElementById('modalReferralCode')) {
                document.getElementById('modalReferralCode').textContent = data.referral_code;
            }
        }
    } catch (e) {
        console.log('Could not load referral info');
    }
}

function copyReferralCode() {
    const code = currentUser?.referral_code;
    if (code && code !== '-') {
        navigator.clipboard.writeText(`https://leadmappo.com/account.html?ref=${code}`);
        alert('Referral link copied to clipboard!');
    }
}

async function logout() {
    hideUserMenu();
    stopUserDataRefresh();
    await chrome.runtime.sendMessage({ type: 'LOGOUT' });
    currentUser = null;
    showScreen('loginScreen');
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('licenseKey').value = '';
}

// Scan controls
async function startScan() {
    const keyword = document.getElementById('keyword').value.trim();
    const location = document.getElementById('location').value.trim();
    
    if (!keyword || !location) {
        alert('Please enter both keyword and location');
        return;
    }
    
    chrome.runtime.sendMessage({ type: 'START_SCAN', keyword, location });
    
    updateStatus('Scanning...');
    document.getElementById('currentSearch').textContent = `${keyword} in ${location}`;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.querySelector('.status-bar').classList.add('scanning');
    startAutoRefresh();
}

async function stopScan() {
    chrome.runtime.sendMessage({ type: 'STOP_SCAN' });
    updateStatus('Stopped');
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    document.querySelector('.status-bar').classList.remove('scanning');
    stopAutoRefresh();
}

function updateStatus(status) {
    document.getElementById('scanStatus').textContent = status;
    if (status === 'Complete' || status === 'Stopped' || status === 'Ready') {
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.querySelector('.status-bar').classList.remove('scanning');
    }
}

function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(loadData, 2000);
}

function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

async function checkScanStatus() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (response?.scanStatus === 'running') {
        updateStatus('Scanning...');
        document.getElementById('startBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
        document.querySelector('.status-bar').classList.add('scanning');
        if (response.currentKeyword && response.currentLocation) {
            document.getElementById('currentSearch').textContent = `${response.currentKeyword} in ${response.currentLocation}`;
        }
        startAutoRefresh();
    }
}

// Data loading
async function loadData() {
    const { extractedData = [] } = await chrome.storage.local.get('extractedData');
    currentData = extractedData;
    
    document.getElementById('resultsCount').textContent = currentData.length;
    renderTable(currentData);
    
    const hasData = currentData.length > 0;
    document.getElementById('exportCsvBtn').disabled = !hasData;
    document.getElementById('exportExcelBtn').disabled = !hasData;
}

function renderTable(data) {
    const tbody = document.getElementById('tableBody');
    
    if (data.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="10" class="empty-state">
                <i class="fas fa-database"></i>
                <p>No data extracted yet. Start scanning to extract businesses.</p>
            </td></tr>`;
        return;
    }
    
    tbody.innerHTML = data.map((item, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${esc(item.business_name)}</strong></td>
            <td>${esc(item.phone)}${item.phone_2 ? '<br><small>' + esc(item.phone_2) + '</small>' : ''}</td>
            <td>${item.email ? esc(item.email) : '-'}</td>
            <td>${item.average_rating ? `<span style="color:#f59e0b;">★</span> ${item.average_rating}` : '-'}</td>
            <td>${item.total_reviews || '-'}</td>
            <td>${esc(item.city)}</td>
            <td>${esc(item.state)}</td>
            <td>${esc(item.country)}</td>
            <td>${item.place_url ? `<a href="${esc(item.place_url)}" target="_blank"><i class="fas fa-external-link-alt"></i></a>` : '-'}</td>
        </tr>`).join('');
}

function esc(str) {
    if (!str) return '-';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// EXPORT FUNCTIONS WITH EXACT COLUMN MAPPING
// Columns: Business Name, Phone, Phone 2, Phone 3, Email, Email 2, Website, Website 2,
// Full Address, Address, City, State, Postal Code, Country, Latitude, Longitude, 
// Average Rating, Total Reviews, Category, Place URL, Place ID, Search Keyword, Search Location

async function exportCSV() {
    if (!currentData.length) return;
    
    // CRITICAL: Check export credits before allowing export
    const creditCheck = await chrome.runtime.sendMessage({ type: 'CHECK_EXPORT_CREDITS' });
    if (creditCheck && !creditCheck.can_proceed) {
        showCreditError(creditCheck.message || 'Insufficient export credits', 'NO_EXPORT_CREDITS');
        return;
    }
    
    // Headers (23 columns - including multiple phones, emails, websites)
    const headers = [
        'Business Name',
        'Phone',
        'Phone 2',
        'Phone 3',
        'Email',
        'Email 2',
        'Website',
        'Website 2',
        'Full Address',
        'Address',
        'City',
        'State',
        'Postal Code',
        'Country',
        'Latitude',
        'Longitude',
        'Average Rating',
        'Total Reviews',
        'Category',
        'Place URL',
        'Place ID',
        'Search Keyword',
        'Search Location'
    ];
    
    const rows = currentData.map(d => [
        d.business_name || '',
        d.phone || '',
        d.phone_2 || '',
        d.phone_3 || '',
        d.email || '',
        d.email_2 || '',
        d.website || '',
        d.website_2 || '',
        d.full_address || '',
        d.address || '',
        d.city || '',
        d.state || '',
        d.postal_code || '',
        d.country || '',
        d.latitude || '',
        d.longitude || '',
        d.average_rating || '',
        d.total_reviews || '',
        d.category || '',
        d.place_url || '',
        d.place_id || '',
        d.search_keyword || '',
        d.search_location || ''
    ]);
    
    const csvContent = [
        headers.join(','),
        ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    // BOM for Excel compatibility
    const BOM = '\uFEFF';
    download(BOM + csvContent, 'gmap_businesses.csv', 'text/csv;charset=utf-8;');
    
    logExport('csv');
}

async function exportExcel() {
    if (!currentData.length || typeof XLSX === 'undefined') {
        alert('Excel export library not loaded. Please try CSV export.');
        return;
    }
    
    // CRITICAL: Check export credits before allowing export
    const creditCheck = await chrome.runtime.sendMessage({ type: 'CHECK_EXPORT_CREDITS' });
    if (creditCheck && !creditCheck.can_proceed) {
        showCreditError(creditCheck.message || 'Insufficient export credits', 'NO_EXPORT_CREDITS');
        return;
    }
    
    // Create data with exact column mapping (23 columns)
    const excelData = currentData.map(d => ({
        'Business Name': d.business_name || '',
        'Phone': d.phone || '',
        'Phone 2': d.phone_2 || '',
        'Phone 3': d.phone_3 || '',
        'Email': d.email || '',
        'Email 2': d.email_2 || '',
        'Website': d.website || '',
        'Website 2': d.website_2 || '',
        'Full Address': d.full_address || '',
        'Address': d.address || '',
        'City': d.city || '',
        'State': d.state || '',
        'Postal Code': d.postal_code || '',
        'Country': d.country || '',
        'Latitude': d.latitude || '',
        'Longitude': d.longitude || '',
        'Average Rating': d.average_rating || '',
        'Total Reviews': d.total_reviews || '',
        'Category': d.category || '',
        'Place URL': d.place_url || '',
        'Place ID': d.place_id || '',
        'Search Keyword': d.search_keyword || '',
        'Search Location': d.search_location || ''
    }));
    
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // Set column widths (23 columns)
    ws['!cols'] = [
        { wch: 35 },  // Business Name
        { wch: 18 },  // Phone
        { wch: 18 },  // Phone 2
        { wch: 18 },  // Phone 3
        { wch: 28 },  // Email
        { wch: 28 },  // Email 2
        { wch: 35 },  // Website
        { wch: 35 },  // Website 2
        { wch: 50 },  // Full Address
        { wch: 40 },  // Address
        { wch: 18 },  // City
        { wch: 18 },  // State
        { wch: 12 },  // Postal Code
        { wch: 15 },  // Country
        { wch: 14 },  // Latitude
        { wch: 14 },  // Longitude
        { wch: 12 },  // Average Rating
        { wch: 12 },  // Total Reviews
        { wch: 25 },  // Category
        { wch: 50 },  // Place URL
        { wch: 20 },  // Place ID
        { wch: 18 },  // Search Keyword
        { wch: 18 }   // Search Location
    ];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Businesses');
    XLSX.writeFile(wb, 'gmap_businesses.xlsx');
    
    logExport('xlsx');
}

function logExport(format) {
    if (currentUser?.id) {
        chrome.runtime.sendMessage({
            type: 'LOG_ACTIVITY',
            userId: currentUser.id,
            action: 'export',
            details: { format, count: currentData.length }
        });
        
        // Refresh user data after export to update credits display
        setTimeout(refreshUserData, 1500);
    }
}

// Helper function to format date in IST
function formatDateIST(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

function formatDateOnlyIST(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function clearData() {
    if (!confirm('Clear all extracted data?')) return;
    await chrome.storage.local.set({ extractedData: [] });
    currentData = [];
    renderTable([]);
    document.getElementById('resultsCount').textContent = '0';
    document.getElementById('currentSearch').textContent = '-';
    document.getElementById('exportCsvBtn').disabled = true;
    document.getElementById('exportExcelBtn').disabled = true;
}

// History
async function showHistory() {
    const { searchHistory = [] } = await chrome.storage.local.get('searchHistory');
    const list = document.getElementById('historyList');
    
    if (searchHistory.length === 0) {
        list.innerHTML = '<li class="empty-state"><p>No search history yet</p></li>';
    } else {
        list.innerHTML = searchHistory.map((h) => `
            <li class="history-item" data-keyword="${esc(h.keyword)}" data-location="${esc(h.location)}">
                <div><span class="history-query">${esc(h.keyword)} in ${esc(h.location)}</span></div>
                <span class="history-time">${timeAgo(h.timestamp)}</span>
            </li>`).join('');
        
        list.querySelectorAll('.history-item').forEach(el => {
            el.addEventListener('click', () => {
                document.getElementById('keyword').value = el.dataset.keyword;
                document.getElementById('location').value = el.dataset.location;
                hideModal('historyModal');
            });
        });
    }
    
    showModal('historyModal');
}

function timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

console.log('[Asha GMap Extractor] Dashboard loaded');
