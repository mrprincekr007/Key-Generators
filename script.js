// firebase-config.js se apna database (db) import kar rahe hain
import { db } from "./firebase-config.js";
import { ref, set, onValue, serverTimestamp, remove } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

const urlParams = new URLSearchParams(window.location.search);

// 2 Alag-Alag Link Variables
const isSecretAccess = urlParams.get('secure') === 'true'; // Normal user ke liye
const isAdminAccess = urlParams.get('admin') === 'true'; // Admin Bypass ke liye (UNLIMITED)

let userKeysArray = JSON.parse(localStorage.getItem('ph_dashboard_keys')) || [];

// Dashboard me abhi bhi max 5 keys hi dikhengi taaki UI kharab na ho
if (userKeysArray.length > 5) {
    userKeysArray = userKeysArray.slice(-5);
    localStorage.setItem('ph_dashboard_keys', JSON.stringify(userKeysArray));
}

let firebaseDataCache = {};

function generateShortKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomPart = '';
    for (let i = 0; i < 6; i++) {
        randomPart += chars[Math.floor(Math.random() * chars.length)];
    }
    return `PH-${randomPart}`; 
}

async function initSystem() {
    // Agar link user wala hai YA admin wala hai
    if (isSecretAccess || isAdminAccess) {
        // Link hide karna taaki URL clean ho jaye
        window.history.replaceState({}, document.title, window.location.pathname);
        document.getElementById('generationCard').style.display = 'block';

        const lastGenTime = localStorage.getItem('ph_last_gen_time');
        const now = new Date().getTime();
        const cooldownTime = 24 * 60 * 60 * 1000; 

        // ADMIN BYPASS LOGIC
        if (isAdminAccess) {
            // Admin ke liye koi time check nahi hoga, direct key banegi
            await createAndRegisterKey();
        } 
        // NORMAL USER LOGIC
        else if (lastGenTime && (now - parseInt(lastGenTime)) < cooldownTime) {
            // Agar normal user hai aur 24 ghante nahi hue, toh limit laga do
            document.getElementById('genLoader').style.display = 'none';
            document.getElementById('genResult').style.display = 'block';
            document.getElementById('genResult').innerHTML = `
                <div class="header-title" style="margin-bottom: 5px; color: #facc15;"><i class="fa-solid fa-shield"></i> Anti-Spam Active</div>
                <p style="color: #94a3b8; font-size: 13px; margin-bottom: 10px;">Aap apni daily key pehle hi generate kar chuke hain. Kripya niche Dashboard me dekhein.</p>
            `;
        } else {
            // Normal user pehli baar aaya hai, toh key banao aur time save karo
            await createAndRegisterKey();
            localStorage.setItem('ph_last_gen_time', now.toString()); 
        }
    }
    
    setupRealtimeSync();
    startCountdownEngine();
}

async function createAndRegisterKey() {
    const newKey = generateShortKey(); 
    const keyRef = ref(db, 'ActiveUserKeys/' + newKey);

    try {
        await set(keyRef, {
            createdAt: serverTimestamp(),
            durationHours: 24,
            isUsed: false,
            boundDeviceId: "NONE"
        });

        if (!userKeysArray.includes(newKey)) {
            userKeysArray.push(newKey);
            if (userKeysArray.length > 5) {
                userKeysArray.shift(); 
            }
            localStorage.setItem('ph_dashboard_keys', JSON.stringify(userKeysArray));
        }

        document.getElementById('newKeyValue').innerText = newKey;
        document.getElementById('genLoader').style.display = 'none';
        document.getElementById('genResult').style.display = 'block';

    } catch (err) {
        console.error("Firebase write error:", err);
        document.getElementById('genLoader').innerHTML = '<p style="color:#ef4444;">Server se connect nahi ho paya!</p>';
    }
}

function setupRealtimeSync() {
    if (userKeysArray.length === 0) {
        document.getElementById('historyLoader').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';
        return;
    }

    let loadedCount = 0;
    document.getElementById('emptyState').style.display = 'none';

    userKeysArray.forEach(key => {
        const keyRef = ref(db, 'ActiveUserKeys/' + key);
        onValue(keyRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                firebaseDataCache[key] = data; 
            } else {
                firebaseDataCache[key] = { expiredOffline: true }; 
            }

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

        let badgeClass = 'badge-unused';
        let badgeText = 'Unused';
        
        if (data.expiredOffline) {
            badgeClass = 'badge-expired';
            badgeText = 'Expired';
        } else if (data.boundDeviceId && data.boundDeviceId !== 'NONE') {
            badgeClass = 'badge-active';
            badgeText = 'Active'; 
        }

        itemDiv.innerHTML = `
            <div class="key-item-header">
                <div class="key-text">
                    ${key} 
                    <i class="fa-solid fa-copy mini-copy" onclick="copyText('${key}')"></i>
                </div>
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
        if (userKeysArray.length === 0) return;

        userKeysArray.forEach(key => {
            const data = firebaseDataCache[key];
            const timerElement = document.getElementById(`timer-${key}`);
            if (!timerElement || !data) return;

            if (data.expiredOffline) {
                timerElement.innerText = "EXPIRED";
                timerElement.className = "timer-box expired";
                return;
            }

            const now = new Date().getTime();
            const createdAtTime = data.createdAt;
            if (!createdAtTime) return;

            const expiryTime = createdAtTime + (24 * 60 * 60 * 1000); 
            const distance = expiryTime - now;

            if (distance < 0) {
                timerElement.innerText = "EXPIRED";
                timerElement.className = "timer-box expired";
                
                const itemElement = document.getElementById(`item-${key}`);
                if (itemElement) {
                    const badge = itemElement.querySelector('.badge');
                    if (badge && !badge.classList.contains('badge-expired')) {
                        badge.className = 'badge badge-expired';
                        badge.innerText = 'Expired';
                    }
                }

                if (!data.expiredOffline) {
                    const keyRef = ref(db, 'ActiveUserKeys/' + key);
                    remove(keyRef).catch(err => console.error("Failed to delete expired key", err));
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

// Copy logic
window.copyText = function(textToCopy) {
    if (textToCopy.includes('XXXX')) return; 
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        const toast = document.getElementById('toast');
        toast.classList.add('show'); 
        
        setTimeout(() => { toast.classList.remove('show'); }, 2500);
    }).catch(err => {
        alert("Copy failed: " + err); 
    });
};

window.onload = initSystem;
