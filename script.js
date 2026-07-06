// script.js
import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { db } from "./firebase-config.js"; 
import { getDatabase, ref, set, onValue, serverTimestamp, remove, push } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// System State Variables
let sysSettings = { 
    cooldownHours: 24, 
    maxKeysLimit: 5, 
    maintenanceMode: false, 
    userParam: 'secure=true', 
    adminParam: 'admin=true', 
    defaultKeyDuration: 24,
    defaultKeyTier: 'normal',
    defaultKeyLifetime: false
};
let externalDbs = []; 
let isSettingsLoaded = false;
let isHubLoaded = false;
let initFired = false;

let firebaseDataCache = {};
let userKeysArray = JSON.parse(localStorage.getItem('ph_dashboard_keys')) || [];

// Cooldown tracking: array of timestamps when keys were generated
let genTimestamps = JSON.parse(localStorage.getItem('ph_gen_timestamps')) || [];

// ==========================================
// 1. Fetch Settings & Mirrors
// ==========================================
onValue(ref(db, 'SystemSettings'), (snapshot) => {
    if(snapshot.exists()) {
        const data = snapshot.val();
        sysSettings = { ...sysSettings, ...data };
        if (!data.defaultKeyDuration) sysSettings.defaultKeyDuration = 24;
        if (!data.defaultKeyTier) sysSettings.defaultKeyTier = 'normal';
    }
    isSettingsLoaded = true;
    triggerSystemInit();
});

onValue(ref(db, 'ConnectedFirebases'), (snapshot) => {
    externalDbs = [];
    if(snapshot.exists()) {
        snapshot.forEach(child => {
            try {
                let app;
                try { app = getApp(child.key); } 
                catch(e) { app = initializeApp(child.val(), child.key); }
                externalDbs.push(getDatabase(app));
            } catch(e) { console.error("Mirror Load Error", e); }
        });
    }
    isHubLoaded = true;
    triggerSystemInit();
    if(initFired) setupRealtimeSync(); 
});

// ==========================================
// 2. Initialize
// ==========================================
function triggerSystemInit() {
    if(isSettingsLoaded && isHubLoaded && !initFired) {
        initFired = true;
        checkAccessAndRun();
    }
}

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

        // ---- FIXED CYCLE COOLDOWN & LIMIT CHECK ----
        const now = Date.now();
        const cooldownMs = sysSettings.cooldownHours * 60 * 60 * 1000;
        const maxKeys = sysSettings.maxKeysLimit;

        // Step 1: Check if the current cycle has expired (based on the FIRST key's time)
        if (genTimestamps.length > 0) {
            const firstKeyTime = genTimestamps[0];
            if (now - firstKeyTime >= cooldownMs) {
                // Cooldown finished! Refresh the limit completely.
                genTimestamps = [];
                localStorage.setItem('ph_gen_timestamps', JSON.stringify(genTimestamps));
            }
        }

        // Step 2: Check if limit is reached in the current active cycle
        if (genTimestamps.length >= maxKeys && !isAdminAccess) {
            // Limit reached – show anti-spam UI and calculate remaining time based on the FIRST key
            const firstKeyTime = genTimestamps[0];
            const timeLeft = cooldownMs - (now - firstKeyTime);
            showAntiSpamUI(timeLeft);
            setupRealtimeSync();
            startCountdownEngine();
            return;
        }

        // If admin access, bypass limits. Normal user gets added to cycle.
        if (isAdminAccess) {
            createAndRegisterKey();
        } else {
            createAndRegisterKey();
            genTimestamps.push(now); // Pehli key banne par time save hoga
            localStorage.setItem('ph_gen_timestamps', JSON.stringify(genTimestamps));
        }
    }
    
    setupRealtimeSync();
    startCountdownEngine();
}

// ==========================================
// 3. Anti‑Spam UI
// ==========================================
function showAntiSpamUI(timeLeftMs) {
    document.getElementById('genLoader').style.display = 'none';
    document.getElementById('genResult').style.display = 'block';
    document.getElementById('genTitle').innerHTML = `<i class="fa-solid fa-shield" style="color: #facc15;"></i> Limit Reached`;
    
    // Show countdown until refresh
    const hours = Math.floor(timeLeftMs / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeftMs % (1000 * 60)) / 1000);
    const timeStr = `${hours}h ${minutes}m ${seconds}s`;
    
    document.getElementById('genDesc').innerText = 
        `Limit Reached (${sysSettings.maxKeysLimit} Keys / ${sysSettings.cooldownHours} Hours). Refresh in ${timeStr}.`;
    document.getElementById('copyBtn').style.display = 'none';
    document.getElementById('newKeyValue').style.display = 'none';
}

// ==========================================
// 4. Generate Key
// ==========================================
function generateShortKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomPart = '';
    for (let i = 0; i < 6; i++) randomPart += chars[Math.floor(Math.random() * chars.length)];
    return randomPart; 
}

async function createAndRegisterKey() {
    const defaultDuration = sysSettings.defaultKeyDuration || 24;
    const defaultTier = sysSettings.defaultKeyTier || 'normal';
    const isVip = defaultTier === 'vip';
    const prefix = isVip ? 'VIP-' : 'PH-';
    const newKey = prefix + generateShortKey();
    
    let duration = defaultDuration;
    let isLifetime = false;
    if (sysSettings.defaultKeyLifetime) {
        duration = 99999;
        isLifetime = true;
    }
    
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
            try {
                await set(ref(extDb, 'ActiveUserKeys/' + newKey), kData);
                successCount++;
            } catch(err) { console.error("Ext DB Sync Error:", err); }
        }

        if(successCount === 0) throw new Error("All servers failed to respond");

        if (!userKeysArray.includes(newKey)) {
            userKeysArray.push(newKey);
            if (userKeysArray.length > sysSettings.maxKeysLimit * 2) {
                userKeysArray.shift();
            }
            localStorage.setItem('ph_dashboard_keys', JSON.stringify(userKeysArray));
        }

        // Update UI
        document.getElementById('newKeyValue').innerText = newKey;
        document.getElementById('newKeyValue').style.display = 'block';
        
        const descEl = document.getElementById('genDesc');
        if (isLifetime) {
            descEl.innerText = 'Valid for Lifetime (Never Expires)';
        } else if (duration >= 24 && duration % 24 === 0) {
            const days = duration / 24;
            descEl.innerText = `Valid for the next ${days} Day${days > 1 ? 's' : ''}`;
        } else {
            descEl.innerText = `Valid for the next ${duration} Hour${duration > 1 ? 's' : ''}`;
        }
        
        document.getElementById('genLoader').style.display = 'none';
        document.getElementById('genResult').style.display = 'block';
        
        setupRealtimeSync(); 

    } catch (err) {
        document.getElementById('genLoader').innerHTML = '<p style="color:#ef4444;">Server error! Kripya baad me try karein.</p>';
    }
}

// ==========================================
// 5. Dashboard & Countdown
// ==========================================
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
        onValue(ref(primaryDb, 'ActiveUserKeys/' + key), (snapshot) => {
            const data = snapshot.val();
            if (data) firebaseDataCache[key] = data; 
            else firebaseDataCache[key] = { expiredOffline: true }; 

            loadedCount++;
            if (loadedCount >= userKeysArray.length) {
                document.getElementById('historyLoader').style.display = 'none';
                document.getElementById('keysContainer').style.display = 'flex';
                renderDashboardUI(); 
            }
        });
    });
}

function renderDashboardUI() {
    const container = document.getElementById('keysContainer');
    container.innerHTML = ''; 

    userKeysArray.slice().reverse().forEach(key => {
        const data = firebaseDataCache[key];
        if (!data) return;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'key-item';
        itemDiv.id = `item-${key}`;

        let badgeClass = 'badge-unused'; let badgeText = 'Unused';
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

function startCountdownEngine() {
    setInterval(() => {
        // Update key timers
        if (userKeysArray.length > 0 && externalDbs.length > 0) {
            userKeysArray.forEach(key => {
                const data = firebaseDataCache[key];
                const timerElement = document.getElementById(`timer-${key}`);
                if (!timerElement || !data) return;

                if (data.expiredOffline) {
                    timerElement.innerText = "EXPIRED"; timerElement.className = "timer-box expired"; 
                    if (!data._removed) {
                        externalDbs.forEach(extDb => remove(ref(extDb, 'ActiveUserKeys/' + key)).catch(e=>{}));
                        data._removed = true;
                    }
                    return;
                }

                const now = Date.now();
                const createdAtTime = data.createdAt;
                if (!createdAtTime) return;

                if (data.durationHours === 99999) {
                    timerElement.innerText = "♾️ Lifetime";
                    timerElement.className = "timer-box";
                    return;
                }

                const expiryTime = createdAtTime + (data.durationHours * 60 * 60 * 1000); 
                const distance = expiryTime - now;

                if (distance < 0) {
                    timerElement.innerText = "EXPIRED"; timerElement.className = "timer-box expired";
                    const badge = document.querySelector(`#item-${key} .badge`);
                    if (badge) { badge.className = 'badge badge-expired'; badge.innerText = 'Expired'; }
                    if (!data._removed) {
                        externalDbs.forEach(extDb => remove(ref(extDb, 'ActiveUserKeys/' + key)).catch(e=>{}));
                        data._removed = true;
                    }
                } else {
                    const hours = Math.floor(distance / (1000 * 60 * 60));
                    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
                    timerElement.innerText = `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
                }
            });
        }

        // Anti‑spam timer ko live update karna
        const genTitle = document.getElementById('genTitle');
        if (genTitle && genTitle.innerHTML.includes('Limit Reached')) {
            const now = Date.now();
            const cooldownMs = sysSettings.cooldownHours * 60 * 60 * 1000;
            if (genTimestamps.length > 0) {
                const firstKeyTime = genTimestamps[0];
                const timeLeft = cooldownMs - (now - firstKeyTime);
                
                if (timeLeft > 0) {
                    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
                    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
                    const timeStr = `${hours}h ${minutes}m ${seconds}s`;
                    document.getElementById('genDesc').innerText = 
                        `Limit Reached (${sysSettings.maxKeysLimit} Keys / ${sysSettings.cooldownHours} Hours). Refresh in ${timeStr}.`;
                } else {
                    // Timer khatam hote hi refresh, taaki user wapas key bana sake!
                    genTimestamps = [];
                    localStorage.setItem('ph_gen_timestamps', JSON.stringify(genTimestamps));
                    window.location.reload();
                }
            }
        }
    }, 1000); 
}

// ==========================================
// 6. Copy helper
// ==========================================
window.copyText = function(textToCopy) {
    if (textToCopy.includes('XXXX')) return; 
    navigator.clipboard.writeText(textToCopy).then(() => {
        const toast = document.getElementById('toast');
        toast.classList.add('show'); 
        setTimeout(() => { toast.classList.remove('show'); }, 2500);
    });
};
