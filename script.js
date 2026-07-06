// script.js
import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { db } from "./firebase-config.js"; 
import { getDatabase, ref, set, onValue, serverTimestamp, remove, push } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// System State Variables
let sysSettings = { cooldownHours: 24, maxKeysLimit: 5, maintenanceMode: false, userParam: 'secure=true', adminParam: 'admin=true', defaultKeyDuration: 24 };
let externalDbs = []; 
let isSettingsLoaded = false;
let isHubLoaded = false;
let initFired = false;

let firebaseDataCache = {};
let userKeysArray = JSON.parse(localStorage.getItem('ph_dashboard_keys')) || [];

// 1. Fetch Rules & Hub Servers from Master Firebase
onValue(ref(db, 'SystemSettings'), (snapshot) => {
    if(snapshot.exists()) {
        const data = snapshot.val();
        sysSettings = { ...sysSettings, ...data };
        // Ensure defaultKeyDuration is set
        if (!data.defaultKeyDuration) {
            // If not set, set default to 24 hours
            sysSettings.defaultKeyDuration = 24;
        }
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

// 2. Initialize App when Data is Ready
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

        const lastGenTime = localStorage.getItem('ph_last_gen_time');
        const now = new Date().getTime();
        const cooldownTime = sysSettings.cooldownHours * 60 * 60 * 1000;

        if (isAdminAccess) {
            createAndRegisterKey(); 
        } else if (lastGenTime && (now - parseInt(lastGenTime)) < cooldownTime) {
            showAntiSpamUI();
        } else {
            createAndRegisterKey();
            localStorage.setItem('ph_last_gen_time', now.toString());
        }
    }
    
    setupRealtimeSync();
    startCountdownEngine();
}

function showAntiSpamUI() {
    document.getElementById('genLoader').style.display = 'none';
    document.getElementById('genResult').style.display = 'block';
    document.getElementById('genTitle').innerHTML = `<i class="fa-solid fa-shield" style="color: #facc15;"></i> Limit Reached`;
    document.getElementById('genDesc').innerText = `Aap ek key pehle hi generate kar chuke hain. Kripya niche Dashboard me check karein.`;
    document.getElementById('copyBtn').style.display = 'none';
    document.getElementById('newKeyValue').style.display = 'none';
}

function generateShortKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomPart = '';
    for (let i = 0; i < 6; i++) randomPart += chars[Math.floor(Math.random() * chars.length)];
    return `PH-${randomPart}`; 
}

// 3. Central Hub Routing: Save ONLY to Mirror DBs
async function createAndRegisterKey() {
    const newKey = generateShortKey(); 
    
    // Read default duration from SystemSettings (set by admin)
    const defaultDuration = sysSettings.defaultKeyDuration || 24;
    
    const kData = {
        createdAt: serverTimestamp(),
        durationHours: defaultDuration,
        isUsed: false,
        boundDeviceId: "NONE",
        type: "Normal"
    };

    try {
        let successCount = 0;
        
        // Write to all mirror DBs only
        for(let extDb of externalDbs) {
            try {
                await set(ref(extDb, 'ActiveUserKeys/' + newKey), kData);
                successCount++;
            } catch(err) { console.error("Ext DB Sync Error:", err); }
        }

        if(successCount === 0) throw new Error("All servers failed to respond");

        // Update local storage
        if (!userKeysArray.includes(newKey)) {
            userKeysArray.push(newKey);
            if (userKeysArray.length > sysSettings.maxKeysLimit) {
                userKeysArray.shift(); 
            }
            localStorage.setItem('ph_dashboard_keys', JSON.stringify(userKeysArray));
        }

        document.getElementById('newKeyValue').innerText = newKey;
        document.getElementById('newKeyValue').style.display = 'block';
        document.getElementById('genLoader').style.display = 'none';
        document.getElementById('genResult').style.display = 'block';
        
        setupRealtimeSync(); 

    } catch (err) {
        document.getElementById('genLoader').innerHTML = '<p style="color:#ef4444;">Server error! Kripya baad me try karein.</p>';
    }
}

// 4. Fetch Dashboard Data from External DB
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
        if (userKeysArray.length === 0 || externalDbs.length === 0) return;

        userKeysArray.forEach(key => {
            const data = firebaseDataCache[key];
            const timerElement = document.getElementById(`timer-${key}`);
            if (!timerElement || !data) return;

            if (data.expiredOffline) {
                timerElement.innerText = "EXPIRED"; timerElement.className = "timer-box expired"; return;
            }

            const now = new Date().getTime();
            const createdAtTime = data.createdAt;
            if (!createdAtTime) return;

            const expiryTime = createdAtTime + (data.durationHours * 60 * 60 * 1000); 
            const distance = expiryTime - now;

            if (distance < 0) {
                timerElement.innerText = "EXPIRED"; timerElement.className = "timer-box expired";
                const badge = document.querySelector(`#item-${key} .badge`);
                if (badge) { badge.className = 'badge badge-expired'; badge.innerText = 'Expired'; }

                if (!data.expiredOffline) {
                    externalDbs.forEach(extDb => remove(ref(extDb, 'ActiveUserKeys/' + key)).catch(e=>{}));
                }
            } else {
                const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((distance % (1000 * 60)) / 1000);
                timerElement.innerText = `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
            }
        });
    }, 1000); 
}

window.copyText = function(textToCopy) {
    if (textToCopy.includes('XXXX')) return; 
    navigator.clipboard.writeText(textToCopy).then(() => {
        const toast = document.getElementById('toast');
        toast.classList.add('show'); 
        setTimeout(() => { toast.classList.remove('show'); }, 2500);
    });
};