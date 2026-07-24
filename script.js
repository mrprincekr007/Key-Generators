// script.js - User Panel (All Fixes Applied)
import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { db } from "./firebase-config.js"; 
import { getDatabase, ref, set, onValue, serverTimestamp, remove, update, increment } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// ===== SYSTEM SETTINGS =====
let sysSettings = { 
    cooldownHours: 24, maxKeysLimit: 5, maintenanceMode: false, 
    userParam: 'secure=true', adminParam: 'admin=true', 
    defaultKeyDuration: 24, defaultKeyTier: 'normal', defaultKeyLifetime: false,
    customKeyPaths: []
};
let externalDbs = []; 
let isSettingsLoaded = false;
let isHubLoaded = false;
let initFired = false;

// ===== CACHES =====
let firebaseDataCache = {};
let userKeysArray = [];
let genTimestamps = [];
let allGeneratedKeys = [];

// ===== LISTENER & INTERVAL MANAGEMENT =====
let activeUnsubscribers = [];
let countdownInterval = null;

// ===== DEBOUNCE UTILITY =====
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// ===== SAFE LOCALSTORAGE =====
function safeGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch(e) { return fallback; }
}
function safeSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { console.warn("Storage full"); }
}

// ===== LOAD CACHES =====
userKeysArray = safeGet('ph_dashboard_keys', []);
genTimestamps = safeGet('ph_gen_timestamps', []);
allGeneratedKeys = safeGet('ph_all_keys', []);

// ===== FIREBASE LISTENERS =====
activeUnsubscribers.push(
    onValue(ref(db, 'SystemSettings'), (snapshot) => {
        if(snapshot.exists()) {
            const data = snapshot.val();
            sysSettings = { ...sysSettings, ...data };
            sysSettings.cooldownHours = parseInt(data.cooldownHours) || 24;
            sysSettings.maxKeysLimit = parseInt(data.maxKeysLimit) || 5;
            if (!data.defaultKeyDuration) sysSettings.defaultKeyDuration = 24;
            if (!data.defaultKeyTier) sysSettings.defaultKeyTier = 'normal';
        }
        isSettingsLoaded = true;
        updateLimitsDisplay();
        triggerSystemInit();
    })
);

activeUnsubscribers.push(
    onValue(ref(db, 'ConnectedFirebases'), (snapshot) => {
        externalDbs = [];
        if(snapshot.exists()) {
            snapshot.forEach(child => {
                try {
                    let app;
                    try { app = getApp(child.key); } catch(e) { app = initializeApp(child.val(), child.key); }
                    externalDbs.push(getDatabase(app));
                } catch(e) { console.error("Mirror Load Error", e); }
            });
        }
        isHubLoaded = true;
        triggerSystemInit();
    })
);

function triggerSystemInit() {
    if(isSettingsLoaded && isHubLoaded && !initFired) {
        initFired = true;
        checkAccessAndRun();
    }
}

function updateLimitsDisplay() {
    const el = document.getElementById('limitsInfo');
    if (!el) return;
    if (sysSettings.showLimitsOnUser === false) { el.style.display = 'none'; return; }
    const cd = sysSettings.cooldownHours || 24;
    const mk = sysSettings.maxKeysLimit || 5;
    const used = genTimestamps.length;
    el.innerHTML = `<i class="fa-solid fa-circle-info"></i> Limit: <strong>${mk}</strong> keys / <strong>${cd}h</strong> cooldown | Used: <strong>${used}/${mk}</strong>`;
    el.style.display = 'block';
}

// ===== ACCESS CONTROL =====
function checkAccessAndRun() {
    const urlParams = new URLSearchParams(window.location.search);
    const userQuery = sysSettings.userParam.split('=');
    const adminQuery = sysSettings.adminParam.split('=');
    const isSecretAccess = urlParams.get(userQuery[0]) === userQuery[1];
    const isAdminAccess = urlParams.get(adminQuery[0]) === adminQuery[1];

    if (sysSettings.maintenanceMode && !isAdminAccess) {
        document.getElementById('maintenanceCard').style.display = 'block';
        document.getElementById('generationCard').style.display = 'none';
        setupRealtimeSync();
        startCountdownEngine();
        return;
    }

    if (isSecretAccess || isAdminAccess) {
        window.history.replaceState({}, document.title, window.location.pathname);
        document.getElementById('generationCard').style.display = 'block';

        if(externalDbs.length === 0) {
            document.getElementById('generationCard').style.display = 'none';
            document.getElementById('errorCard').style.display = 'block';
            setupRealtimeSync();
            return;
        }

        const now = Date.now();
        const cooldownMs = sysSettings.cooldownHours * 60 * 60 * 1000;
        const maxKeys = sysSettings.maxKeysLimit;

        if (genTimestamps.length > 0) {
            const firstKeyTime = genTimestamps[0];
            if (now - firstKeyTime >= cooldownMs) {
                genTimestamps = [];
                safeSet('ph_gen_timestamps', genTimestamps);
            }
        }

        if (genTimestamps.length >= maxKeys && !isAdminAccess) {
            const firstKeyTime = genTimestamps[0];
            const timeLeft = cooldownMs - (now - firstKeyTime);
            showAntiSpamUI(timeLeft);
            setupRealtimeSync();
            startCountdownEngine();
            return;
        }

        createAndRegisterKey();
        if (!isAdminAccess) {
            genTimestamps.push(now); 
            safeSet('ph_gen_timestamps', genTimestamps);
            updateLimitsDisplay();
        }
    }
    
    setupRealtimeSync();
    startCountdownEngine();
}

function showAntiSpamUI(timeLeftMs) {
    document.getElementById('genLoader').style.display = 'none';
    document.getElementById('genResult').style.display = 'block';
    document.getElementById('genTitle').innerHTML = `<i class="fa-solid fa-shield" style="color: #facc15;"></i> Limit Reached`;
    const hours = Math.floor(timeLeftMs / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeftMs % (1000 * 60)) / 1000);
    document.getElementById('genDesc').innerText = `Limit Reached (${sysSettings.maxKeysLimit} Keys / ${sysSettings.cooldownHours} Hours). Refresh in ${hours}h ${minutes}m ${seconds}s.`;
    document.getElementById('copyBtn').style.display = 'none';
    document.getElementById('newKeyValue').style.display = 'none';
    updateLimitsDisplay();
}

// ===== KEY GENERATION =====
function generateShortKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let r = '';
    for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
    return r; 
}

async function createAndRegisterKey() {
    const defaultDuration = sysSettings.defaultKeyDuration || 24;
    const defaultTier = sysSettings.defaultKeyTier || 'normal';
    const isVip = defaultTier === 'vip';
    const prefix = isVip ? 'VIP-' : 'PH-';
    const newKey = prefix + generateShortKey();
    
    let duration = sysSettings.defaultKeyLifetime ? 99999 : defaultDuration;
    const isLifetime = duration === 99999;
    
    const kData = {
        createdAt: serverTimestamp(),
        durationHours: duration,
        isUsed: false,
        boundDeviceId: "NONE",
        type: isVip ? "VIP" : "Normal"
    };

    try {
        let successCount = 0;
        for(let extDb of externalDbs) {
            try { await set(ref(extDb, 'ActiveUserKeys/' + newKey), kData); successCount++; }
            catch(err) { console.error("Ext DB Sync Error:", err); }
        }

        // Write to custom key paths in all external DBs
        const customPaths = sysSettings.customKeyPaths || [];
        for (const customPath of customPaths) {
            for (let extDb of externalDbs) {
                await set(ref(extDb, customPath + '/' + newKey), kData).catch(err => console.error("Custom path sync:", err));
            }
        }

        if(successCount === 0 && customPaths.length === 0) throw new Error("All servers failed");

        try {
            set(ref(db, 'SystemStats/totalLifetimeGenerated'), increment(1)).catch(()=>{});
            const d = new Date();
            const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            set(ref(db, `SystemStats/DailyGenerations/${ds}`), increment(1)).catch(()=>{});
        } catch(e) {}

        if (!userKeysArray.includes(newKey)) {
            userKeysArray.push(newKey);
            if (userKeysArray.length > sysSettings.maxKeysLimit * 2) userKeysArray.shift();
            safeSet('ph_dashboard_keys', userKeysArray);
        }
        if (!allGeneratedKeys.find(k => k.key === newKey)) {
            allGeneratedKeys.push({ key: newKey, type: isVip ? 'VIP' : 'Normal', duration: duration, createdAt: Date.now() });
            safeSet('ph_all_keys', allGeneratedKeys);
        }

        document.getElementById('newKeyValue').innerText = newKey;
        document.getElementById('newKeyValue').style.display = 'block';
        
        const descEl = document.getElementById('genDesc');
        if (isLifetime) descEl.innerText = 'Valid for Lifetime (Never Expires)';
        else if (duration >= 24 && duration % 24 === 0) {
            const days = duration / 24;
            descEl.innerText = `Valid for the next ${days} Day${days > 1 ? 's' : ''}`;
        } else descEl.innerText = `Valid for the next ${duration} Hour${duration > 1 ? 's' : ''}`;
        
        document.getElementById('genLoader').style.display = 'none';
        document.getElementById('genResult').style.display = 'block';
        document.getElementById('shareBtn').style.display = 'inline-flex';
        setupRealtimeSync(); 
    } catch (err) {
        document.getElementById('genLoader').innerHTML = '<p style="color:#ef4444;">Server error! Kripya baad me try karein.</p>';
    }
}

// ===== DASHBOARD SYNC =====
function setupRealtimeSync() {
    if (userKeysArray.length === 0) {
        document.getElementById('historyLoader').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';
        return;
    }
    if (externalDbs.length === 0) return;

    let primaryDb = externalDbs[0]; 
    let loadedCount = 0;
    document.getElementById('emptyState').style.display = 'none';

    userKeysArray.forEach(key => {
        activeUnsubscribers.push(
            onValue(ref(primaryDb, 'ActiveUserKeys/' + key), (snapshot) => {
                const data = snapshot.val();
                firebaseDataCache[key] = data || { expiredOffline: true };
                loadedCount++;
                if (loadedCount >= userKeysArray.length) {
                    document.getElementById('historyLoader').style.display = 'none';
                    document.getElementById('keysContainer').style.display = 'flex';
                    renderDashboardUI(); 
                }
            })
        );
    });
}

function renderDashboardUI() {
    const container = document.getElementById('keysContainer');
    container.innerHTML = ''; 
    userKeysArray.slice().reverse().forEach(key => {
        const data = firebaseDataCache[key];
        if (!data) return;
        const itemDiv = document.createElement('div');
        itemDiv.className = 'key-item key-appear';
        itemDiv.id = `item-${key}`;

        let badgeClass = 'badge-unused', badgeText = 'Unused';
        if (data.expiredOffline) { badgeClass = 'badge-expired'; badgeText = 'Expired'; } 
        else if (data.boundDeviceId && data.boundDeviceId !== 'NONE') { badgeClass = 'badge-active'; badgeText = 'Active'; }

        itemDiv.innerHTML = `
            <div class="key-item-header">
                <div class="key-text">${key} <i class="fa-solid fa-copy mini-copy" onclick="copyText('${key}')"></i></div>
                <span class="badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="key-item-footer">
                <span>Status:</span>
                <span class="timer-box" id="timer-${key}">Loading...</span>
            </div>
        `;
        container.appendChild(itemDiv);
    });
}

// ===== COUNTDOWN ENGINE (Debounced Removal) =====
const debouncedRemoveKey = debounce((key) => {
    externalDbs.forEach(extDb => {
        remove(ref(extDb, 'ActiveUserKeys/' + key)).catch(()=>{});
        const customPaths = sysSettings.customKeyPaths || [];
        customPaths.forEach(p => remove(ref(extDb, p + '/' + key)).catch(()=>{}));
    });
}, 2000);

function startCountdownEngine() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        if (userKeysArray.length > 0 && externalDbs.length > 0) {
            userKeysArray.forEach(key => {
                const data = firebaseDataCache[key];
                const timerElement = document.getElementById(`timer-${key}`);
                if (!timerElement || !data) return;

                if (data.expiredOffline) {
                    timerElement.innerText = "EXPIRED"; 
                    timerElement.className = "timer-box expired"; 
                    if (!data._removed) { data._removed = true; debouncedRemoveKey(key); }
                    return;
                }

                const now = Date.now();
                const createdAtTime = data.createdAt;
                if (!createdAtTime) return;

                if (data.durationHours === 99999) {
                    timerElement.innerText = "Lifetime"; 
                    timerElement.className = "timer-box";
                    return;
                }

                const expiryTime = createdAtTime + (data.durationHours * 60 * 60 * 1000); 
                const distance = expiryTime - now;

                if (distance < 0) {
                    timerElement.innerText = "EXPIRED"; 
                    timerElement.className = "timer-box expired";
                    const badge = document.querySelector(`#item-${key} .badge`);
                    if (badge) { badge.className = 'badge badge-expired'; badge.innerText = 'Expired'; }
                    if (!data._removed) { data._removed = true; debouncedRemoveKey(key); }
                } else {
                    // EXPIRY WARNING (5 min before)
                    if (distance <= 300000 && distance > 299000 && !data._warned) {
                        data._warned = true;
                        showExpiryWarning(key, distance);
                    }
                    const hours = Math.floor(distance / (1000 * 60 * 60));
                    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
                    timerElement.innerText = `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
                }
            });
        }

        // Cooldown timer
        const genTitle = document.getElementById('genTitle');
        if (genTitle && genTitle.innerHTML.includes('Limit Reached')) {
            const now = Date.now();
            const cooldownMs = sysSettings.cooldownHours * 60 * 60 * 1000;
            if (genTimestamps.length > 0) {
                const timeLeft = cooldownMs - (now - genTimestamps[0]);
                if (timeLeft > 0) {
                    const h = Math.floor(timeLeft / 3600000);
                    const m = Math.floor((timeLeft % 3600000) / 60000);
                    const s = Math.floor((timeLeft % 60000) / 1000);
                    document.getElementById('genDesc').innerText = `Limit Reached (${sysSettings.maxKeysLimit} Keys / ${sysSettings.cooldownHours} Hours). Refresh in ${h}h ${m}m ${s}s.`;
                } else {
                    genTimestamps = [];
                    safeSet('ph_gen_timestamps', genTimestamps);
                    window.location.reload();
                }
            }
        }
    }, 1000); 
}

// ===== EXPIRY WARNING =====
function showExpiryWarning(key, timeLeft) {
    const warningDiv = document.getElementById('expiryWarning');
    if (warningDiv) {
        const minutes = Math.ceil(timeLeft / 60000);
        warningDiv.innerHTML = `<i class="fa-solid fa-exclamation-triangle"></i> Key <strong>${key}</strong> expires in ${minutes} min!`;
        warningDiv.style.display = 'block';
        setTimeout(() => { warningDiv.style.display = 'none'; }, 10000);
    }
}

// ===== OFFLINE DETECTION =====
function setupOfflineDetection() {
    const offlineDiv = document.getElementById('offlineIndicator');
    function updateStatus() {
        if (navigator.onLine) {
            offlineDiv.style.display = 'none';
            document.body.classList.remove('offline');
        } else {
            offlineDiv.style.display = 'flex';
            document.body.classList.add('offline');
        }
    }
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
}

// ===== COPY (with fallback) =====
window.copyText = function(text) {
    if (text.includes('XXXX')) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast();
    }).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showToast();
    });
};

function showToast() {
    const toast = document.getElementById('toast');
    toast.classList.add('show'); 
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== SHARE =====
window.shareKey = async function(key) {
    if (navigator.share) {
        try { await navigator.share({ title: 'My Key', text: `Key: ${key}` }); }
        catch(e) { copyText(key); }
    } else { copyText(key); }
};

// ===== THEME TOGGLE =====
window.toggleTheme = function() {
    const isLight = document.body.classList.toggle('light-theme');
    safeSet('ph_theme', isLight ? 'light' : 'dark');
    const icon = document.querySelector('#themeToggle i');
    if (icon) icon.className = isLight ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
};

// ===== KEY HISTORY (for all generated keys) =====
window.showKeyHistory = function() {
    const modal = document.getElementById('historyModal');
    const list = document.getElementById('historyList');
    if (!modal || !list) return;
    list.innerHTML = '';
    if (allGeneratedKeys.length === 0) {
        list.innerHTML = '<div class="empty-state">No keys generated yet</div>';
    } else {
        allGeneratedKeys.slice().reverse().forEach(item => {
            const isActive = userKeysArray.includes(item.key);
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div class="history-key">${item.key}</div>
                <div class="history-meta">${item.type} | ${item.duration === 99999 ? 'Lifetime' : item.duration + 'h'} | ${isActive ? 'Active' : 'Inactive'}</div>
            `;
            div.onclick = () => copyText(item.key);
            list.appendChild(div);
        });
    }
    modal.style.display = 'flex';
};

window.closeHistoryModal = function() {
    const modal = document.getElementById('historyModal');
    if (modal) modal.style.display = 'none';
};

// ===== CLEANUP =====
window.addEventListener('beforeunload', () => {
    if (countdownInterval) clearInterval(countdownInterval);
});

// ===== INIT =====
setupOfflineDetection();
const savedTheme = safeGet('ph_theme', 'dark');
if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    document.addEventListener('DOMContentLoaded', () => {
        const icon = document.querySelector('#themeToggle i');
        if (icon) icon.className = 'fa-solid fa-moon';
    });
}
