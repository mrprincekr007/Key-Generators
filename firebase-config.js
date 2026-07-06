// firebase-config.js (For both Admin & User Panel)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAdQ9zRcNgRyB2ySfbZbS4oJ-yxhSMU-aA",
  authDomain: "key-generator-c29a4.firebaseapp.com",
  databaseURL: "https://key-generator-c29a4-default-rtdb.firebaseio.com",
  projectId: "key-generator-c29a4",
  storageBucket: "key-generator-c29a4.firebasestorage.app",
  messagingSenderId: "49313730345",
  appId: "1:49313730345:web:eb4ce85cbd278d2859f138",
  measurementId: "G-98MMJBC8M3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
